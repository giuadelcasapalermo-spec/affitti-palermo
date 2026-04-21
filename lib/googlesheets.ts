import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Entrata, Uscita, CATEGORIE_USCITA, Impostazioni } from './types';
import { leggiEntrate, scriviEntrate } from './entrate';
import { leggiUscite, scriviUscite } from './uscite';
import { leggiPrenotazioni, scriviPrenotazioni } from './db';
import { leggiImpostazioni } from './ical';
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
    const ncols = hIdx >= 0 ? (rows[hIdx] as (string|number)[]).length : 0;
    const is2025 = ncols <= 12;
    const dataICol = is2025 ? 6 : 10;

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
          '', '', '', '', '',
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

    const ncols = rows[hIdx].length;
    const is2025 = ncols <= 12;
    const C = is2025
      ? { tipo:0, desc:1, usc:4, dataI:6, stanza:9, note:11 }
      : { tipo:0, desc:1, usc:4, dataI:10, stanza:13, note:15 };

    // Chiavi trovate in questo tab (per la pulizia)
    const trovatiNelTab = new Set<string>();

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const tipo = String(row[C.tipo]??'').trim().toLowerCase();
      if (!TIPO_AMMESSI_TABS.has(tipo)) continue;

      const desc   = String(row[C.desc]??'').trim();
      const uscita = parseFloat(String(row[C.usc]??'')) || 0;
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
        uscite.push({ id: randomUUID(), data, descrizione: desc, categoria: cat, importo: uscita, camera_id, note, created_at: now });
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
export async function dedupPrenotazioniIcal(): Promise<number> {
  const prenotazioni = await leggiPrenotazioni();
  const manuali = prenotazioni.filter(p => !p.ical_uid && p.stato !== 'cancellata');
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

// ── Arricchimento prenotazioni iCal da tab mensili (Affitto) ─────────────
// Legge le righe "Affitto" nei tab mensili e aggiorna le prenotazioni iCal
// che hanno camera+check_in corrispondenti, riempiendo ospite_nome e importo_totale.
async function arricchisciPrenotazioniDaSheets(
  sheets: ReturnType<typeof google.sheets>,
  tabEsistenti: Set<string>,
  sid: string,
): Promise<number> {
  const prenotazioni = await leggiPrenotazioni();
  // Indice: "cameraId|check_in" → prenotazione iCal
  const byKey = new Map(
    prenotazioni
      .filter(p => !!p.ical_uid)
      .map(p => [`${p.camera_id}|${p.check_in}`, p])
  );
  if (byKey.size === 0) return 0;

  let aggiornate = 0;

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

    const ncols = rows[hIdx].length;
    const is2025 = ncols <= 12;
    // entrata = col C (indice 2) in entrambi i formati
    const C = is2025
      ? { tipo:0, desc:1, ent:3, tassa:-1, dataI:6, stanza:9 }
      : { tipo:0, desc:1, ent:3, tassa:5,  dataI:10, stanza:13 };

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const tipo = String(row[C.tipo]??'').trim().toLowerCase();
      if (!['affitto', 'ricavo booking', 'ricavo privato'].includes(tipo)) continue;

      const data = parseSheetDate(row[C.dataI] as string|number|undefined);
      if (!data) continue;

      const stanza    = String(row[C.stanza]??'').trim().toLowerCase();
      const camera_id = STANZA_ID[stanza];
      if (!camera_id) continue;

      const key = `${camera_id}|${data}`;
      const pren = byKey.get(key);
      if (!pren) continue;

      const nome    = String(row[C.desc]??'').trim();
      const importo = parseFloat(String(row[C.ent]??'')) || 0;
      const tassa   = C.tassa >= 0 ? (parseFloat(String(row[C.tassa]??'')) || 0) : 0;

      let modificata = false;
      if (nome && (!pren.ospite_nome || pren.ospite_nome === 'Ospite Booking.com')) {
        pren.ospite_nome = nome;
        modificata = true;
      }
      if (importo > 0) {
        pren.importo_totale = importo;
        modificata = true;
      }
      if (tassa > 0) {
        pren.tassa_soggiorno = tassa;
        modificata = true;
      }
      if (modificata) aggiornate++;
    }
  }

  if (aggiornate > 0) {
    await scriviPrenotazioni(prenotazioni);
  }
  return aggiornate;
}

// ── Arricchisci prenotazioni iCal da sheet (wrapper pubblico) ────────────
export async function arricchisciPrenotazioniDaSheetsAll(): Promise<number> {
  const sid    = await getSpreadsheetId();
  const sheets = await getSheetsClient();
  const meta   = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const tabEsistenti = new Set(meta.data.sheets?.map(s => s.properties?.title ?? '') ?? []);
  return arricchisciPrenotazioniDaSheets(sheets, tabEsistenti, sid);
}

// ── Import completo: Prima Nota App + tab mensili → App (solo uscite) ────
export async function importFromSheets(): Promise<{ importate: number; ignorate: number; rimosse: number; doppioniRimossi: number; prenotazioniArricchite: number }> {
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
      uscite.push({ id: id||randomUUID(), data, descrizione, categoria: cat, importo, camera_id, note: note??'', created_at: now });
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
  const prenotazioniArricchite = await arricchisciPrenotazioniDaSheets(sheets, tabEsistenti, sid);

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
    return { ical_urls: {}, nomi_camere: {} };
  }

  const imp: Impostazioni = { ical_urls: {}, nomi_camere: {} };
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
