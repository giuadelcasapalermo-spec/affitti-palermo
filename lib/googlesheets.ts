import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Entrata, Uscita, CATEGORIE_USCITA } from './types';
import { leggiEntrate, scriviEntrate } from './entrate';
import { leggiUscite, scriviUscite } from './uscite';
import { leggiPrenotazioni, scriviPrenotazioni } from './db';
import { randomUUID } from 'crypto';

const SPREADSHEET_ID = '1t8sY-JBkSDAnIBhQA_xwotRjxAzRCJ1XMUrxbpHlJpM';
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
const STANZA_ID: Record<string, number> = {
  'bianca': 1, 'camera 1': 1, '1': 1,
  'gialla': 2, 'camera 2': 2, '2': 2,
  'rossa': 3, 'camera 3': 3, '3': 3,
  'verde': 4, 'camera 4': 4, '4': 4,
  'blue': 5, 'blu': 5, 'camera 5': 5, '5': 5,
};
const STANZA_NOME: Record<number, string> = { 1:'Bianca', 2:'Gialla', 3:'Rossa', 4:'Verde', 5:'Blue' };

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

async function ensureSheet(sheets: ReturnType<typeof google.sheets>): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
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
  const sheets    = await getSheetsClient();
  const sheetName = await ensureSheet(sheets);
  const range     = `'${sheetName}'!A:H`;
  const entrate   = await leggiEntrate();
  const uscite    = await leggiUscite();
  const righe = [
    HEADER,
    ...[...entrate.map(entrataToRow), ...uscite.map(uscitaToRow)]
      .sort((a, b) => b[2].localeCompare(a[2])),
  ];
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
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
): Promise<number> {
  // Raggruppa uscite per tab mensile
  const perTab = new Map<string, Uscita[]>();
  for (const u of uscite) {
    if (!u.data) continue;
    const tab = tabPerData(u.data);
    if (!tabEsistenti.has(tab)) continue; // tab non esiste nel documento, salta
    if (!perTab.has(tab)) perTab.set(tab, []);
    perTab.get(tab)!.push(u);
  }

  let aggiunte = 0;

  for (const [tab, usciteDelTab] of perTab) {
    // Leggi righe esistenti per deduplicare su descrizione+importo
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values ?? []) as (string|number)[][];
    // Chiave di deduplicazione: descrizione+importo già presenti
    const esistenti = new Set(
      rows.map(r => `${String(r[1]??'').trim().toLowerCase()}|${parseFloat(String(r[4]??''))||0}`)
    );

    const nuoveRighe: (string|number)[][] = [];
    for (const u of usciteDelTab) {
      const k = `${u.descrizione.trim().toLowerCase()}|${u.importo}`;
      if (esistenti.has(k)) continue;
      esistenti.add(k);
      const tipo = CAT_TO_TIPO[u.categoria] ?? 'Spese varie';
      const stanza = u.camera_id ? (STANZA_NOME[u.camera_id] ?? '') : '';
      nuoveRighe.push([
        tipo,
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
      aggiunte++;
    }

    if (nuoveRighe.length === 0) continue;

    // Trova prima riga vuota nel tab (appendi in fondo)
    const nextRow = rows.length + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!A${nextRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: nuoveRighe },
    });
  }

  return aggiunte;
}

// ── Tab mensili → App (uscite con data inizio) ────────────────────────────
async function importUsciteOriginale(
  sheets: ReturnType<typeof google.sheets>,
  uscite: Uscita[],
  keyUsc: Set<string>,
  keyDataCat: Set<string>,
  tabEsistenti: Set<string>,
): Promise<number> {
  let importate = 0;
  const now = new Date().toISOString();

  for (const tab of tabEsistenti) {
    if (tab === SHEET_NAME) continue;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const tipo = String(row[C.tipo]??'').trim().toLowerCase();
      // Importa SOLO spese operative dai tab mensili (whitelist ristretta)
      if (!TIPO_AMMESSI_TABS.has(tipo)) continue;

      const desc   = String(row[C.desc]??'').trim();
      const uscita = parseFloat(String(row[C.usc]??'')) || 0;
      // Solo righe con data inizio compilata
      const data   = parseSheetDate(row[C.dataI] as string|number|undefined);
      if (!data || uscita <= 0 || !desc) continue;

      const cat = TIPO_TO_CAT[tipo] ?? 'Altro';

      // Salta se già esiste un'uscita nello stesso giorno con la stessa categoria
      if (keyDataCat.has(`${data}|${cat}`)) continue;
      // Salta se già presente per data+descrizione+importo
      const k = `${data}|${desc}|${uscita}`;
      if (keyUsc.has(k)) continue;

      keyUsc.add(k);
      keyDataCat.add(`${data}|${cat}`);
      const stanza   = String(row[C.stanza]??'').trim().toLowerCase();
      const note     = String(row[C.note]??'').trim();
      const camera_id = STANZA_ID[stanza] ?? undefined;

      uscite.push({ id: randomUUID(), data, descrizione: desc, categoria: cat, importo: uscita, camera_id, note, created_at: now });
      importate++;
    }
  }
  return importate;
}

// ── Export completo: Prima Nota App + tab mensili ─────────────────────────
export async function syncToSheets(): Promise<void> {
  const sheets  = await getSheetsClient();
  const meta    = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabEsistenti = new Set(meta.data.sheets?.map(s => s.properties?.title ?? '') ?? []);
  const uscite  = await leggiUscite();

  // 1. Scrivi "Prima Nota App"
  await exportToSheets();

  // 2. Aggiungi uscite dell'app nei tab mensili
  await exportUsciteToTabs(sheets, uscite, tabEsistenti);
}

// ── Dedup prenotazioni iCal: rimuove Booking-duplicate di prenotazioni manuali ──
export async function dedupPrenotazioniIcal(): Promise<number> {
  const prenotazioni = await leggiPrenotazioni();
  const chiaviManuali = new Set(
    prenotazioni
      .filter(p => !p.ical_uid && p.stato !== 'cancellata')
      .map(p => `${p.camera_id}|${p.check_in}|${p.check_out}`)
  );
  const doppioni = prenotazioni.filter(
    p => !!p.ical_uid && chiaviManuali.has(`${p.camera_id}|${p.check_in}|${p.check_out}`)
  );
  if (doppioni.length > 0) {
    const idsRimuovere = new Set(doppioni.map(p => p.id));
    await scriviPrenotazioni(prenotazioni.filter(p => !idsRimuovere.has(p.id)));
  }
  return doppioni.length;
}

// ── Import completo: Prima Nota App + tab mensili → App (solo uscite) ────
export async function importFromSheets(): Promise<{ importate: number; ignorate: number; doppioniRimossi: number }> {
  const sheets  = await getSheetsClient();
  const meta    = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabEsistenti = new Set(meta.data.sheets?.map(s => s.properties?.title ?? '') ?? []);

  const uscite = await leggiUscite();

  const keyUsc    = new Set(uscite.map(u => `${u.data}|${u.descrizione}|${u.importo}`));
  const keyDataCat = new Set(uscite.map(u => `${u.data}|${u.categoria}`));
  const idsUscite = new Set(uscite.map(u => u.id));
  const now = new Date().toISOString();

  let importate = 0;
  let ignorate  = 0;

  // 1. Legge il foglio "Prima Nota App" — importa SOLO uscite (le entrate vengono gestite dall'app)
  const sheetName = await ensureSheet(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${sheetName}'!A:H` });
  for (const row of (res.data.values ?? []).slice(1).filter(r => r[0] && r[1] && r[2] && r[3])) {
    const [id, tipo, data, descrizione, categoria, importoStr, cameraIdStr, note] = row;
    if (tipo !== 'uscita') { ignorate++; continue; }
    if (idsUscite.has(id)) { ignorate++; continue; }
    const importo   = parseFloat(importoStr) || 0;
    const camera_id = cameraIdStr ? parseInt(cameraIdStr) || undefined : undefined;
    const cat = CATEGORIE_USCITA.includes(categoria as never) ? categoria as Uscita['categoria'] : 'Altro';
    // Salta se già esiste un'uscita nello stesso giorno con la stessa categoria
    if (keyDataCat.has(`${data}|${cat}`)) { ignorate++; continue; }
    uscite.push({ id: id||randomUUID(), data, descrizione, categoria: cat, importo, camera_id, note: note??'', created_at: now });
    keyUsc.add(`${data}|${descrizione}|${importo}`);
    keyDataCat.add(`${data}|${cat}`);
    importate++;
  }

  // 2. Legge tab mensili — importa uscite con data inizio
  const nuove = await importUsciteOriginale(sheets, uscite, keyUsc, keyDataCat, tabEsistenti);
  importate += nuove;

  await scriviUscite(uscite);

  // 3. Rimuovi prenotazioni iCal doppione
  const doppioniRimossi = await dedupPrenotazioniIcal();

  return { importate, ignorate, doppioniRimossi };
}
