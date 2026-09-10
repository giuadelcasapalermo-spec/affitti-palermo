import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Entrata, Uscita, CATEGORIE_USCITA, Impostazioni, Prenotazione } from './types';
import { leggiEntrate, scriviEntrate } from './entrate';
import { leggiUscite, scriviUscite } from './uscite';
import { leggiPrenotazioni, scriviPrenotazioni } from './db';
import { getStrutturaAttiva } from './strutture';
import { leggiImpostazioni, riconciliaBlocchiIcal } from './ical';
import { randomUUID } from 'crypto';

const SPREADSHEET_ID_FALLBACK = '1t8sY-JBkSDAnIBhQA_xwotRjxAzRCJ1XMUrxbpHlJpM';

async function getSpreadsheetId(): Promise<string> {
  const imp = await leggiImpostazioni();
  return imp.google_sheet_id?.trim() || SPREADSHEET_ID_FALLBACK;
}
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME ?? 'Prima Nota App';

const HEADER = ['ID', 'Tipo', 'Data', 'Descrizione', 'Categoria', 'Importo', 'CameraID', 'Note'];

// ── Mappe ──────────────────────────────────────────────────────────────────
const MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

const CAT_TO_TIPO: Record<string, string> = {
  Arredamento: 'Arredamento', Utenze: 'Utenze', Manutenzione: 'Manutenzione',
  Forniture: 'Acquisti varie', Pulizie: 'Pulizie', Affitto: 'Affitto',
  Tasse: 'Tasse', Commissioni: 'Commissioni', Pubblicità: 'Pubblicità', Altro: 'Spese varie',
};
const TIPO_TO_CAT: Record<string, Uscita['categoria']> = {
  arredamento: 'Arredamento', utenze: 'Utenze', manutenzione: 'Manutenzione',
  'acquisti varie': 'Forniture', 'spese varie': 'Forniture', pulizie: 'Pulizie',
  affitto: 'Affitto', tasse: 'Tasse', commissioni: 'Commissioni', 'pubblicità': 'Pubblicità',
};

// Tipi ammessi dall'import dei tab mensili: solo spese operative ricorrenti.
// Esclusi: tasse, commissioni, affitto, pubblicità — queste voci vengono scritte
// in modo diverso in ogni tab mensile (es. "Tassa di soggiorno 2026", "Tassa di soggiorno
// I trimestre"…) generando falsi duplicati. Si inseriscono da Prima Nota direttamente.
const TIPO_AMMESSI_TABS = new Set([
  'arredamento', 'utenze', 'manutenzione', 'acquisti varie', 'spese varie', 'pulizie',
]);

// Categorie corrispondenti ai tipi ammessi (per la pulizia del DB)
const CATEGORIE_AMMESSE_TABS = new Set<string>(
  [...TIPO_AMMESSI_TABS].map(t => TIPO_TO_CAT[t] ?? 'Altro')
);

/** Converte nome tab → prefisso mese ISO (es. "Aprile" → "2026-04") */
function monthPrefixForTab(tab: string): string | null {
  for (let i = 0; i < MESI_IT.length; i++) {
    const mm = String(i + 1).padStart(2, '0');
    if (tab === MESI_IT[i])           return `2026-${mm}`;
    if (tab === `${MESI_IT[i]}2025`)  return `2025-${mm}`;
    if (tab === `${MESI_IT[i]}2024`)  return `2024-${mm}`;
  }
  return null;
}
const STANZA_ID: Record<string, number> = {
  'rossa': 1, 'camera 1': 1, '1': 1,
  'gialla': 2, 'camera 2': 2, '2': 2,
  'verde': 3, 'camera 3': 3, '3': 3,
  'bianca': 4, 'camera 4': 4, '4': 4,
  'blue': 5, 'blu': 5, 'camera 5': 5, '5': 5,
};
const STANZA_NOME: Record<number, string> = { 1:'Rossa', 2:'Gialla', 3:'Verde', 4:'Bianca', 5:'Blue' };

// ── Helpers data ───────────────────────────────────────────────────────────
function isoToSerial(iso: string): number {
  return Math.round(new Date(iso + 'T00:00:00Z').getTime() / 86400000) + 25569;
}
function serialToISO(serial: number): string {
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
}
/** Parsa un importo dal foglio: gestisce numeri JS, "€ 84,15", "84.15", "84,15" */
function parseImporto(val: string | number | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/[€$£ \s]/g, '').replace(',', '.');
  return parseFloat(s) || 0;
}

function parseSheetDate(val: string | number | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'number') return serialToISO(val);
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

/** Nome del tab mensile per una data ISO (es. "2026-04-13" → "Aprile") */
function tabPerData(iso: string): string {
  const [year, month] = iso.split('-');
  const nome = MESI_IT[parseInt(month) - 1];
  return year === '2026' ? nome : `${nome}${year}`;
}

// ── Auth ───────────────────────────────────────────────────────────────────
function getAuth() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Configura GOOGLE_CLIENT_ID+SECRET+REFRESH_TOKEN oppure GOOGLE_SERVICE_ACCOUNT_JSON');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

async function getSheetsClient() {
  const auth = getAuth();
  const resolvedAuth = auth instanceof GoogleAuth ? await auth.getClient() : auth;
  return google.sheets({ version: 'v4', auth: resolvedAuth as never });
}

async function ensureSheet(sheets: ReturnType<typeof google.sheets>, sid: string): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
  }
  return SHEET_NAME;
}

function entrataToRow(e: Entrata): string[] {
  return [e.id,'entrata',e.data,e.descrizione,e.categoria,String(e.importo),String(e.camera_id??''),e.note??''];
}
function uscitaToRow(u: Uscita): string[] {
  return [u.id,'uscita',u.data,u.descrizione,u.categoria,String(u.importo),String(u.camera_id??''),u.note??''];
}

// ── App → Google Sheets (tab "Prima Nota App") ────────────────────────────
export async function exportToSheets(): Promise<void> {
  const sid       = await getSpreadsheetId();
  const sheets    = await getSheetsClient();
  const sheetName = await ensureSheet(sheets, sid);
  const range     = `'${sheetName}'!A:H`;
  const entrate   = await leggiEntrate();
  const uscite    = await leggiUscite();
  const righe = [
    HEADER,
    ...[...entrate.map(entrataToRow), ...uscite.map(uscitaToRow)]
      .sort((a, b) => b[2].localeCompare(a[2])),
  ];
  await sheets.spreadsheets.values.clear({ spreadsheetId: sid, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: righe },
  });
}

// ── App → tab mensili (uscite nuove) ──────────────────────────────────────
async function exportUsciteToTabs(
  sheets: ReturnType<typeof google.sheets>,
  uscite: Uscita[],
  tabEsistenti: Set<string>,
  sid: string,
): Promise<number> {
  const perTab = new Map<string, Uscita[]>();
  for (const u of uscite) {
    if (!u.data) continue;
    const tab = tabPerData(u.data);
    if (!tabEsistenti.has(tab)) continue;
    if (!perTab.has(tab)) perTab.set(tab, []);
    perTab.get(tab)!.push(u);
  }

  let processate = 0;

  for (const [tab, usciteDelTab] of perTab) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `'${tab}'!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values ?? []) as (string|number)[][];

    const hIdx = rows.findIndex(r => String(r[0]??'').trim() === 'Tipologia');
    const ncols0 = (rows[Math.max(0, hIdx)]?.length ?? 0);
    const is2025 = ncols0 > 0 && ncols0 <= 12;
    const dataICol = is2025 ? 6 : 8;

    // Mappa data|tipo → riga 1-based nel foglio (per upsert)
    const keyToRow = new Map<string, number>();
    for (let i = (hIdx >= 0 ? hIdx + 1 : 0); i < rows.length; i++) {
      const row = rows[i];
      const tipo = String(row[0]??'').trim().toLowerCase();
      const dataVal = row[dataICol];
      if (!dataVal || !tipo) continue;
      const data = parseSheetDate(dataVal as string|number|undefined);
      if (!data) continue;
      keyToRow.set(`${data}|${tipo}`, i + 1);
    }

    const nuoveRighe: (string|number)[][] = [];

    for (const u of usciteDelTab) {
      const tipoStr = CAT_TO_TIPO[u.categoria] ?? 'Spese varie';
      const key = `${u.data}|${tipoStr.toLowerCase()}`;
      const rowIdx = keyToRow.get(key);

      if (rowIdx !== undefined) {
        // Aggiorna descrizione e importo nella riga esistente (col B:E)
        await sheets.spreadsheets.values.update({
          spreadsheetId: sid,
          range: `'${tab}'!B${rowIdx}:E${rowIdx}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[u.descrizione, -u.importo, '', u.importo]] },
        });
        processate++;
      } else {
        const stanza = u.camera_id ? (STANZA_NOME[u.camera_id] ?? '') : '';
        nuoveRighe.push([
          tipoStr,
          u.descrizione,
          -u.importo,
          '',
          u.importo,
          '', '', '',
          isoToSerial(u.data),
          '',
          '',
          stanza,
          '',
          u.note ?? '',
        ]);
        processate++;
      }
    }

    if (nuoveRighe.length > 0) {
      const nextRow = rows.length + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `'${tab}'!A${nextRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: nuoveRighe },
      });
    }
  }

  return processate;
}

// ── Tab mensili → App (uscite con data inizio) ────────────────────────────
async function importUsciteOriginale(
  sheets: ReturnType<typeof google.sheets>,
  uscite: Uscita[],
  tabEsistenti: Set<string>,
  sid: string,
): Promise<{ importate: number; aggiornate: number; rimosse: number }> {
  let importate = 0;
  let aggiornate = 0;
  let rimosse = 0;
  const now = new Date().toISOString();

  const buildKeyMap = () => {
    const m = new Map<string, number>();
    for (let i = 0; i < uscite.length; i++) {
      m.set(`${uscite[i].data}|${uscite[i].categoria}`, i);
    }
    return m;
  };
  let keyMap = buildKeyMap();

  for (const tab of tabEsistenti) {
    if (tab === SHEET_NAME) continue;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `'${tab}'!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values ?? []) as (string|number)[][];

    const hIdx = rows.findIndex(r => String(r[0]??'').trim() === 'Tipologia');
    if (hIdx === -1) continue;

    const ncols1 = rows[hIdx]?.length ?? 0;
    const is2025 = ncols1 > 0 && ncols1 <= 12;
    const C = is2025
      ? { tipo:0, desc:1, usc:4, dataI:6, stanza:9, note:11 }
      : { tipo:0, desc:1, usc:4, dataI:8,  stanza:11, note:13 };

    // Chiavi trovate in questo tab (per la pulizia)
    const trovatiNelTab = new Set<string>();

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const tipo = String(row[C.tipo]??'').trim().toLowerCase();
      if (!TIPO_AMMESSI_TABS.has(tipo)) continue;

      const desc   = String(row[C.desc]??'').trim();
      const uscita = parseImporto(row[C.usc] as string|number|undefined);
      const data   = parseSheetDate(row[C.dataI] as string|number|undefined);
      if (!data || uscita <= 0 || !desc) continue;

      const cat = TIPO_TO_CAT[tipo] ?? 'Altro';
      const k   = `${data}|${cat}`;
      trovatiNelTab.add(k);

      const existingIdx = keyMap.get(k);
      if (existingIdx !== undefined) {
        uscite[existingIdx].descrizione = desc;
        uscite[existingIdx].importo = uscita;
        aggiornate++;
      } else {
        const stanza    = String(row[C.stanza]??'').trim().toLowerCase();
        const note      = String(row[C.note]??'').trim();
        const camera_id = STANZA_ID[stanza] ?? undefined;
        keyMap.set(k, uscite.length);
        uscite.push({ id: randomUUID(), data, descrizione: desc, categoria: cat, importo: uscita, camera_id, note, fonte_pagamento: 'Contanti', created_at: now });
        importate++;
      }
    }

    // Rimuovi dal DB le uscite del mese corrispondente a questo tab
    // che NON sono state trovate nello sheet (sync completo per mese)
    const monthPrefix = monthPrefixForTab(tab);
    if (monthPrefix) {
      const idsRimuovere = new Set<string>();
      const vistiKey = new Set<string>(); // dedup: tieni solo il primo per chiave
      for (const u of uscite) {
        if (!u.data.startsWith(monthPrefix)) continue;
        if (!CATEGORIE_AMMESSE_TABS.has(u.categoria)) continue;
        const k = `${u.data}|${u.categoria}`;
        if (!trovatiNelTab.has(k) || vistiKey.has(k)) {
          idsRimuovere.add(u.id);
        } else {
          vistiKey.add(k);
        }
      }
      if (idsRimuovere.size > 0) {
        const before = uscite.length;
        uscite.splice(0, uscite.length, ...uscite.filter(u => !idsRimuovere.has(u.id)));
        rimosse += before - uscite.length;
        keyMap = buildKeyMap();
      }
    }
  }
  return { importate, aggiornate, rimosse };
}

// ── Export completo: Prima Nota App + tab mensili ─────────────────────────
export async function syncToSheets(): Promise<void> {
  const sid     = await getSpreadsheetId();
  const sheets  = await getSheetsClient();
  const meta    = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const tabEsistenti = new Set(meta.data.sheets?.map(s => s.properties?.title ?? '') ?? []);
  const uscite  = await leggiUscite();

  // 1. Scrivi "Prima Nota App"
  await exportToSheets();

  // 2. Aggiungi uscite dell'app nei tab mensili
  await exportUsciteToTabs(sheets, uscite, tabEsistenti, sid);
}

// ── Dedup prenotazioni iCal: rimuove Booking-duplicate di prenotazioni manuali ──
// Confronta solo con prenotazioni inserite a mano (fonte 'manuale'): le prenotazioni
// create da arricchisciPrenotazioniDaSheets (fonte 'sheet') sono placeholder, non
// conferme che la prenotazione Booking sia un doppione — non devono causare la
// rimozione di clienti Booking che nello sheet non sono ancora presenti.
export async function dedupPrenotazioniIcal(): Promise<number> {
  const prenotazioni = await leggiPrenotazioni();
  const manuali = prenotazioni.filter(p => p.fonte === 'manuale' && p.stato !== 'cancellata');
  // Chiave 1: camera + date (corrispondenza esatta)
  const chiaviCamera = new Set(manuali.map(p => `${p.camera_id}|${p.check_in}|${p.check_out}`));
  // Chiave 2: nome ospite + date (gestisce discrepanze camera_id tra iCal ed Excel)
  const chiaviNome = new Set(
    manuali
      .filter(p => p.ospite_nome?.trim())
      .map(p => `${p.ospite_nome.toLowerCase().trim()}|${p.check_in}|${p.check_out}`)
  );
  const doppioni = prenotazioni.filter(p => {
    if (!p.ical_uid) return false;
    return (
      chiaviCamera.has(`${p.camera_id}|${p.check_in}|${p.check_out}`) ||
      (p.ospite_nome?.trim() &&
        chiaviNome.has(`${p.ospite_nome.toLowerCase().trim()}|${p.check_in}|${p.check_out}`))
    );
  });
  if (doppioni.length > 0) {
    const idsRimuovere = new Set(doppioni.map(p => p.id));
    await scriviPrenotazioni(prenotazioni.filter(p => !idsRimuovere.has(p.id)));
  }
  return doppioni.length;
}

// ── Allineamento prenotazioni da tab mensili ──────────────────────────────
// Per ogni riga di ricavo nel foglio:
//   - Cerca per chiave stanza+check_in+check_out
//   - Se trovata → aggiorna nome/importo/tassa
//   - Se non trovata → inserisce nuovo record
async function arricchisciPrenotazioniDaSheets(
  sheets: ReturnType<typeof google.sheets>,
  tabEsistenti: Set<string>,
  sid: string,
  struttura_id?: string,
): Promise<{ modificate: number; saltate: string[] }> {
  const prenotazioni = await leggiPrenotazioni(struttura_id);

  const attive = prenotazioni.filter(p => p.stato !== 'cancellata');
  // Indice esatto: camera|check_in|check_out → prenotazione
  const byKey = new Map<string, Prenotazione>(
    attive.map(p => [`${p.camera_id}|${p.check_in}|${p.check_out}`, p])
  );
  // Fallback: camera|check_in → prenotazione (quando checkout iCal ≠ checkout sheet)
  const byCheckIn = new Map<string, Prenotazione>(
    attive.map(p => [`${p.camera_id}|${p.check_in}`, p])
  );
  // Il fallback byCheckIn ignora il check_out: va bene quando iCal e sheet riportano lo
  // stesso soggiorno con un checkout leggermente diverso, ma Booking.com unisce soggiorni
  // consecutivi in un unico blocco iCal (stesso camera_id, un solo check_in ma un periodo
  // molto più lungo). Se lo lasciassimo abbinare anche in quel caso, il rigo sheet di UNO
  // dei soggiorni sovrascriverebbe le date dell'intero blocco, cancellando ogni traccia
  // degli altri soggiorni ancora non registrati sul foglio. Accettiamo il match solo se il
  // check_out esistente è vicino a quello del rigo sheet (entro un giorno).
  function matchByCheckIn(map: Map<string, Prenotazione>, key: string, checkOut: string): Prenotazione | undefined {
    const cand = map.get(key);
    if (!cand) return undefined;
    const diffGiorni = Math.abs(new Date(cand.check_out).getTime() - new Date(checkOut).getTime()) / 86_400_000;
    return diffGiorni <= 1 ? cand : undefined;
  }

  let modificate = 0;
  const saltate: string[] = [];
  const now = new Date().toISOString();

  for (const tab of tabEsistenti) {
    if (tab === SHEET_NAME) continue;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `'${tab}'!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values ?? []) as (string|number)[][];

    const hIdx = rows.findIndex(r => String(r[0]??'').trim() === 'Tipologia');
    if (hIdx === -1) continue;

    const ncols2 = rows[hIdx]?.length ?? 0;
    const headerRow2 = rows[hIdx] as (string|number)[];
    const telefonoIdx = headerRow2.findIndex((c: string|number) => {
      const v = String(c ?? '').toLowerCase().trim();
      return v === 'cellulare' || v === 'email';
    });
    const shift2 = (telefonoIdx >= 0 && telefonoIdx <= 2) ? 1 : 0;
    const is2025 = ncols2 > 0 && ncols2 <= (12 + shift2);
    const C = is2025
      ? { tipo:0, desc:1, telefono:telefonoIdx, ent:3+shift2, tassa:-1,       dataI:6+shift2, dataF:7+shift2, stanza:9+shift2  }
      : { tipo:0, desc:1, telefono:telefonoIdx, ent:3+shift2, tassa:5+shift2, dataI:8+shift2, dataF:9+shift2, stanza:11+shift2 };

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const tipoRaw = String(row[C.tipo]??'').trim();
      const tipo = tipoRaw.toLowerCase();
      const isRicavo =
        tipo === 'affitto' ||
        tipo.startsWith('ricavo') ||
        tipo.includes('booking') ||
        tipo.includes('airbnb') ||
        tipo.includes('privato');
      if (!isRicavo) continue;

      const checkIn  = parseSheetDate(row[C.dataI] as string|number|undefined);
      if (!checkIn) {
        saltate.push(`${tab} riga ${i+1}: tipo="${tipoRaw}" checkIn nullo (raw=${JSON.stringify(row[C.dataI])})`);
        continue;
      }
      const checkOut = parseSheetDate(row[C.dataF] as string|number|undefined) ?? checkIn;

      const stanzaRaw = String(row[C.stanza]??'').trim();
      const stanzaL = stanzaRaw.toLowerCase();
      let camera_id = STANZA_ID[stanzaL];
      if (!camera_id) {
        for (const [k, id] of Object.entries(STANZA_ID)) {
          if (k.length > 1 && stanzaL.includes(k)) { camera_id = id; break; }
        }
      }
      if (!camera_id) {
        saltate.push(`${tab} riga ${i+1}: stanza="${stanzaRaw}" non riconosciuta`);
        continue;
      }

      const nome    = String(row[C.desc]??'').trim();
      const importo = parseImporto(row[C.ent] as string|number|undefined);
      const tassa   = C.tassa >= 0 ? parseImporto(row[C.tassa] as string|number|undefined) : 0;
      const telefono = C.telefono >= 0 ? String(row[C.telefono] ?? '').trim() : '';
      if (importo <= 0) {
        saltate.push(`${tab} riga ${i+1}: "${nome}" ${checkIn} importo=${importo} (raw=${JSON.stringify(row[C.ent])})`);
        continue;
      }

      const key  = `${camera_id}|${checkIn}|${checkOut}`;
      let pren = byKey.get(key) ?? matchByCheckIn(byCheckIn, `${camera_id}|${checkIn}`, checkOut);
      if (!pren) {
        for (const delta of [-1, 1]) {
          const d = new Date(checkIn + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() + delta);
          const altCheckIn = d.toISOString().split('T')[0];
          pren = byKey.get(`${camera_id}|${altCheckIn}|${checkOut}`)
              ?? matchByCheckIn(byCheckIn, `${camera_id}|${altCheckIn}`, checkOut);
          if (pren) break;
        }
      }

      if (pren) {
        if (nome) pren.ospite_nome = nome;
        pren.check_in = checkIn;
        pren.check_out = checkOut;
        pren.importo_totale = importo;
        if (tassa > 0) pren.tassa_soggiorno = tassa;
        if (telefono) pren.ospite_telefono = telefono;
        modificate++;
      } else {
        const nuova: Prenotazione = {
          id: randomUUID(),
          struttura_id,
          camera_id,
          ospite_nome: nome || 'Sconosciuto',
          ospite_telefono: telefono,
          ospite_email: '',
          check_in: checkIn,
          check_out: checkOut,
          importo_totale: importo,
          tassa_soggiorno: tassa > 0 ? tassa : undefined,
          stato: 'confermata',
          note: tipo.charAt(0).toUpperCase() + tipo.slice(1),
          created_at: now,
          fonte: 'sheet',
        };
        prenotazioni.push(nuova);
        byKey.set(key, nuova);
        modificate++;
      }
    }
  }

  if (modificate > 0) {
    await scriviPrenotazioni(prenotazioni, struttura_id);
  }
  return { modificate, saltate };
}

// ── Arricchisci prenotazioni iCal da sheet (wrapper pubblico) ────────────
export async function arricchisciPrenotazioniDaSheetsAll(struttura_id?: string): Promise<{ modificate: number; saltate: string[] }> {
  const sid    = await getSpreadsheetId();
  const sheets = await getSheetsClient();
  const meta   = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const tabEsistenti = new Set(meta.data.sheets?.map(s => s.properties?.title ?? '') ?? []);
  return arricchisciPrenotazioniDaSheets(sheets, tabEsistenti, sid, struttura_id);
}

// ── Nuova prenotazione Booking (da email) → riga nel tab mensile ─────────
// Scrive nelle sole colonne "manuali" (Tipologia, Descrizione, Cellulare, Tassa,
// Booking, Data inizio/fine, Fornitore, Stanza, Note) e ricrea le formule delle
// colonne derivate (Differenza, Entrate, % Booking) copiando esattamente il
// pattern già usato dalle righe esistenti: =E{r}-F{r}, =H{r}*0,55, =H{r}*0,45.
export interface NuovoRicavoBooking {
  ospite_nome: string;
  ospite_telefono?: string;
  check_in: string;
  check_out: string;
  camera_id: number;
  importo_lordo: number;
  tassa_soggiorno?: number;
  note?: string;
}

export async function inserisciRicavoBookingNelFoglio(
  dati: NuovoRicavoBooking,
  opts: { dryRun?: boolean } = {},
): Promise<{ inserita: boolean; tab: string; riga?: number; motivo?: string }> {
  const tab = tabPerData(dati.check_in);
  const sid = await getSpreadsheetId();
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const tabEsistenti = new Set(meta.data.sheets?.map((s) => s.properties?.title ?? '') ?? []);
  if (!tabEsistenti.has(tab)) {
    return { inserita: false, tab, motivo: `tab "${tab}" non esiste nel foglio` };
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: `'${tab}'!A:O`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = (res.data.values ?? []) as (string | number)[][];

  const hIdx = rows.findIndex((r) => String(r[0] ?? '').trim() === 'Tipologia');
  if (hIdx === -1) return { inserita: false, tab, motivo: 'riga intestazione "Tipologia" non trovata' };

  const headerRow = rows[hIdx] as (string | number)[];
  const telefonoIdx = headerRow.findIndex((c) => {
    const v = String(c ?? '').toLowerCase().trim();
    return v === 'cellulare' || v === 'email';
  });
  const shift = telefonoIdx >= 0 && telefonoIdx <= 2 ? 1 : 0;
  const ncols = headerRow.length;
  const is2025 = ncols > 0 && ncols <= 12 + shift;
  if (is2025 || shift !== 1) {
    return { inserita: false, tab, motivo: 'layout del tab non riconosciuto (diverso da quello verificato con colonna "Cellulare" e split Booking), inserimento non supportato per sicurezza' };
  }
  const C = { dataI: 8 + shift, stanza: 11 + shift };

  const stanzaNome = STANZA_NOME[dati.camera_id] ?? '';

  // ── Cerca duplicati e punto di inserimento tra le righe di ricavo datate ─
  // L'inserimento va sempre dentro il blocco di righe datate (non in fondo al
  // tab, dove ci sono righe di totali/riepilogo senza data in colonna J).
  let insertBeforeRow: number | null = null; // 1-based
  let lastDatedRow: number | null = null; // 1-based, ultima riga di ricavo con data valida
  let duplicato = false;
  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const tipo = String(row[0] ?? '').trim().toLowerCase();
    const isRicavo = tipo === 'affitto' || tipo.startsWith('ricavo') || tipo.includes('booking') || tipo.includes('airbnb') || tipo.includes('privato');
    if (!isRicavo) continue;
    const data = parseSheetDate(row[C.dataI] as string | number | undefined);
    if (!data) continue;
    lastDatedRow = i + 1;
    const stanzaRaw = String(row[C.stanza] ?? '').trim().toLowerCase();
    if (stanzaRaw === stanzaNome.toLowerCase() && data === dati.check_in) {
      duplicato = true;
      break;
    }
    if (insertBeforeRow === null && data > dati.check_in) {
      insertBeforeRow = i + 1; // 1-based
    }
  }
  if (duplicato) {
    return { inserita: false, tab, motivo: 'esiste già una riga con stessa camera e stesso check-in' };
  }
  const rigaInserimento = insertBeforeRow ?? (lastDatedRow !== null ? lastDatedRow + 1 : rows.length + 1);
  const insertIdx0 = rigaInserimento - 1; // 0-based, indice della riga PRIMA della quale inserire

  const sheetId = meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (sheetId === undefined) return { inserita: false, tab, motivo: 'sheetId non trovato' };

  // Quando la nuova riga è cronologicamente l'ultima del blocco datato (insertBeforeRow ===
  // null), viene inserita esattamente subito PRIMA della riga di totali che segue. Google
  // Sheets estende automaticamente i riferimenti di un intervallo (es. SUM(E3:E28)) solo se il
  // punto di inserimento cade STRETTAMENTE dentro l'intervallo referenziato — inserire subito
  // dopo l'ultima riga referenziata (qui: subito prima della riga totali) non lo estende, per
  // cui il nuovo ricavo resterebbe silenziosamente fuori dal totale del mese. Leggiamo quindi
  // le formule SUM della riga di totali PRIMA di inserire, e dopo l'inserimento le riscriviamo
  // allargando il limite superiore di un rigo, così da includere la riga appena aggiunta.
  const totaliDaEstendere: { colonna: string; formula: string }[] = [];
  if (insertBeforeRow === null && lastDatedRow !== null) {
    const totRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `'${tab}'!A${rigaInserimento}:O${rigaInserimento}`,
      valueRenderOption: 'FORMULA',
    });
    const totRow = (totRes.data.values?.[0] ?? []) as string[];
    const tipoTot = String(totRow[0] ?? '').trim();
    if (tipoTot === '') {
      const COLONNE = ['B','C','D','E','F','G','H','I','J','K','L','M','N','O'];
      for (let c = 0; c < COLONNE.length; c++) {
        const formula = String(totRow[c + 1] ?? '');
        // Estende solo le SUM il cui estremo superiore è esattamente l'ultima riga datata:
        // altre SUM più corte nella stessa riga di totali (es. un subtotale "Quantità" che
        // copre solo le righe di spesa non datate, non l'intero blocco) vanno lasciate
        // intatte — non coprivano il blocco datato per scelta, non per un limite del range.
        const m = formula.match(/^=SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)$/i);
        if (m && Number(m[2]) === lastDatedRow) {
          totaliDaEstendere.push({ colonna: COLONNE[c], formula });
        }
      }
    }
  }

  if (opts.dryRun) {
    return { inserita: true, tab, riga: rigaInserimento, motivo: 'dry run: nessuna scrittura effettuata' };
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: insertIdx0, endIndex: insertIdx0 + 1 },
          inheritFromBefore: insertIdx0 > hIdx + 1,
        },
      }],
    },
  });

  const r = rigaInserimento;
  const riga: (string | number)[] = [
    'Ricavo Booking',
    dati.ospite_nome,
    dati.ospite_telefono ?? '',
    `=E${r}-F${r}`,
    `=H${r}*0,55`,
    '',
    dati.tassa_soggiorno ?? '',
    dati.importo_lordo,
    `=H${r}*0,45`,
    isoToSerial(dati.check_in),
    isoToSerial(dati.check_out),
    'Booking',
    stanzaNome,
    '',
    dati.note ?? '',
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `'${tab}'!A${r}:O${r}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [riga] },
  });

  // Estende di un rigo le SUM catturate prima dell'inserimento (vedi commento sopra): la riga
  // di totali si è spostata di una posizione insieme a tutto quello che stava sotto di essa.
  if (totaliDaEstendere.length > 0) {
    const rigaTotali = rigaInserimento + 1;
    const updates = totaliDaEstendere.map(({ colonna, formula }) => {
      const estesa = formula.replace(/(:[A-Z]+)(\d+)\)$/i, (_m, prefisso, num) => `${prefisso}${Number(num) + 1})`);
      return { range: `'${tab}'!${colonna}${rigaTotali}`, values: [[estesa]] };
    });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sid,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }

  return { inserita: true, tab, riga: r };
}

// ── Completa a mano (dall'app) una riga scheletro già inserita nel foglio ──
// Trova la riga per camera+check-in (creata da inserisciRicavoBookingNelFoglio) e
// aggiorna solo le celle manuali (Descrizione, Cellulare, Tassa, Booking) — non
// tocca la posizione della riga né le formule già presenti.
export async function aggiornaRigaSheetPerPrenotazione(dati: {
  check_in: string;
  camera_id: number;
  ospite_nome: string;
  ospite_telefono?: string;
  importo_lordo: number;
  tassa_soggiorno?: number;
}): Promise<{ aggiornata: boolean; tab: string; riga?: number; motivo?: string }> {
  const tab = tabPerData(dati.check_in);
  const sid = await getSpreadsheetId();
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const tabEsistenti = new Set(meta.data.sheets?.map((s) => s.properties?.title ?? '') ?? []);
  if (!tabEsistenti.has(tab)) return { aggiornata: false, tab, motivo: `tab "${tab}" non esiste` };

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: `'${tab}'!A:O`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = (res.data.values ?? []) as (string | number)[][];

  const hIdx = rows.findIndex((r) => String(r[0] ?? '').trim() === 'Tipologia');
  if (hIdx === -1) return { aggiornata: false, tab, motivo: 'riga intestazione "Tipologia" non trovata' };

  const headerRow = rows[hIdx] as (string | number)[];
  const telefonoIdx = headerRow.findIndex((c) => {
    const v = String(c ?? '').toLowerCase().trim();
    return v === 'cellulare' || v === 'email';
  });
  const shift = telefonoIdx >= 0 && telefonoIdx <= 2 ? 1 : 0;
  if (headerRow.length <= 12 + shift || shift !== 1) {
    return { aggiornata: false, tab, motivo: 'layout del tab non riconosciuto' };
  }
  const C = { dataI: 8 + shift, stanza: 11 + shift };
  const stanzaNome = STANZA_NOME[dati.camera_id] ?? '';

  const candidate: number[] = []; // indici 0-based
  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const data = parseSheetDate(row[C.dataI] as string | number | undefined);
    if (data !== dati.check_in) continue;
    const stanzaRaw = String(row[C.stanza] ?? '').trim().toLowerCase();
    if (stanzaRaw !== stanzaNome.toLowerCase()) continue;
    candidate.push(i);
  }
  if (candidate.length !== 1) {
    return { aggiornata: false, tab, motivo: `${candidate.length} righe corrispondenti (serve esattamente 1)` };
  }

  const r = candidate[0] + 1; // 1-based
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `'${tab}'!B${r}:C${r}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[dati.ospite_nome, dati.ospite_telefono ?? '']] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `'${tab}'!G${r}:H${r}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[dati.tassa_soggiorno ?? '', dati.importo_lordo]] },
  });

  return { aggiornata: true, tab, riga: r };
}

// ── Import completo: Prima Nota App + tab mensili → App (solo uscite) ────
export async function importFromSheets(struttura_id?: string): Promise<{ importate: number; ignorate: number; rimosse: number; doppioniRimossi: number; prenotazioniArricchite: number }> {
  const sid     = await getSpreadsheetId();
  const sheets  = await getSheetsClient();
  const meta    = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const tabEsistenti = new Set(meta.data.sheets?.map(s => s.properties?.title ?? '') ?? []);

  const uscite = await leggiUscite();
  const now = new Date().toISOString();

  // ── Deduplicazione legacy: per ogni data|categoria tieni la voce con descrizione più lunga ──
  // Rimuove i doppioni creati dalla migrazione JSON (es. "Tassa di soggiorno" vs "…I trimestre 2026")
  {
    const gruppi = new Map<string, Uscita[]>();
    for (const u of uscite) {
      const k = `${u.data}|${u.categoria}`;
      if (!gruppi.has(k)) gruppi.set(k, []);
      gruppi.get(k)!.push(u);
    }
    const idsRimuovi = new Set<string>();
    for (const gruppo of gruppi.values()) {
      if (gruppo.length <= 1) continue;
      gruppo.sort((a, b) =>
        b.descrizione.length !== a.descrizione.length
          ? b.descrizione.length - a.descrizione.length
          : b.created_at.localeCompare(a.created_at)
      );
      for (let i = 1; i < gruppo.length; i++) idsRimuovi.add(gruppo[i].id);
    }
    if (idsRimuovi.size > 0) {
      uscite.splice(0, uscite.length, ...uscite.filter(u => !idsRimuovi.has(u.id)));
    }
  }

  let importate = 0;
  let ignorate  = 0;

  // Mappa data|categoria → indice per upsert
  const keyMap = new Map<string, number>();
  for (let i = 0; i < uscite.length; i++) {
    keyMap.set(`${uscite[i].data}|${uscite[i].categoria}`, i);
  }

  // 1. Legge il foglio "Prima Nota App" — importa SOLO uscite (le entrate vengono gestite dall'app)
  const sheetName = await ensureSheet(sheets, sid);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `'${sheetName}'!A:H` });
  for (const row of (res.data.values ?? []).slice(1).filter(r => r[0] && r[1] && r[2] && r[3])) {
    const [id, tipo, data, descrizione, categoria, importoStr, cameraIdStr, note] = row;
    if (tipo !== 'uscita') { ignorate++; continue; }
    const importo   = parseFloat(importoStr) || 0;
    const camera_id = cameraIdStr ? parseInt(cameraIdStr) || undefined : undefined;
    const cat = CATEGORIE_USCITA.includes(categoria as never) ? categoria as Uscita['categoria'] : 'Altro';
    const k = `${data}|${cat}`;
    const existingIdx = keyMap.get(k);
    if (existingIdx !== undefined) {
      uscite[existingIdx].descrizione = descrizione;
      uscite[existingIdx].importo = importo;
      importate++;
    } else {
      keyMap.set(k, uscite.length);
      uscite.push({ id: id||randomUUID(), data, descrizione, categoria: cat, importo, camera_id, note: note??'', fonte_pagamento: 'Contanti', created_at: now });
      importate++;
    }
  }

  // 2. Legge tab mensili — importa uscite con data inizio
  const { importate: nuoveImportate, aggiornate: nuoveAggiornate, rimosse: rimosse2 } = await importUsciteOriginale(sheets, uscite, tabEsistenti, sid);
  importate += nuoveImportate + nuoveAggiornate;

  await scriviUscite(uscite);

  // 3. Rimuovi prenotazioni iCal doppione
  const doppioniRimossi = await dedupPrenotazioniIcal();

  // 4. Arricchisci prenotazioni iCal con nome ospite e importo dai tab mensili
  const { modificate: prenotazioniArricchite } = await arricchisciPrenotazioniDaSheets(sheets, tabEsistenti, sid, struttura_id);

  // 5. Restringe/cancella i blocchi iCal ormai coperti dalle prenotazioni reali appena arricchite
  await riconciliaBlocchiIcal(struttura_id);

  return { importate, ignorate, rimosse: rimosse2, doppioniRimossi, prenotazioniArricchite };
}

// ── Impostazioni su Google Sheets (tab "Impostazioni") ────────────────────
const IMP_SHEET = 'Impostazioni';

async function ensureImpostazioniSheet(sheets: ReturnType<typeof google.sheets>, sid: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === IMP_SHEET);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: { requests: [{ addSheet: { properties: { title: IMP_SHEET } } }] },
    });
  }
}

export async function leggiImpostazioniSheets(): Promise<Impostazioni> {
  const sid    = await getSpreadsheetId();
  const sheets = await getSheetsClient();
  await ensureImpostazioniSheet(sheets, sid);

  let rows: (string | number)[][];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `'${IMP_SHEET}'!A:C`,
    });
    rows = (res.data.values ?? []) as (string | number)[][];
  } catch {
    return { ical_urls: {}, nomi_camere: {}, prezzi_camere: {}, colori_camere: {}, num_camere: 5 };
  }

  const imp: Impostazioni = { ical_urls: {}, nomi_camere: {}, prezzi_camere: {}, colori_camere: {}, num_camere: 5 };
  for (const row of rows.slice(1)) {
    const tipo   = String(row[0] ?? '').trim();
    const id     = String(row[1] ?? '').trim();
    const valore = String(row[2] ?? '').trim();
    if (!tipo || !id) continue;
    const idNum = Number(id);
    if (tipo === 'camera' && !isNaN(idNum)) imp.nomi_camere[idNum] = valore;
    else if (tipo === 'ical' && !isNaN(idNum)) imp.ical_urls[idNum] = valore;
    else if (tipo === 'sync' && id === 'ultimo_sync') imp.ultimo_sync = valore;
  }
  return imp;
}

export async function scriviImpostazioniSheets(imp: Impostazioni): Promise<void> {
  const sid    = await getSpreadsheetId();
  const sheets = await getSheetsClient();
  await ensureImpostazioniSheet(sheets, sid);

  const rows: string[][] = [['Tipo', 'ID', 'Valore']];
  for (const [id, nome] of Object.entries(imp.nomi_camere ?? {})) {
    rows.push(['camera', id, nome]);
  }
  for (const [id, url] of Object.entries(imp.ical_urls ?? {})) {
    rows.push(['ical', id, url ?? '']);
  }
  if (imp.ultimo_sync) {
    rows.push(['sync', 'ultimo_sync', imp.ultimo_sync]);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sid,
    range: `'${IMP_SHEET}'!A:C`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `'${IMP_SHEET}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}
