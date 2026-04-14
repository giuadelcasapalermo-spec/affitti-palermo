import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Entrata, Uscita, CATEGORIE_ENTRATA, CATEGORIE_USCITA } from './types';
import { leggiEntrate, scriviEntrate } from './entrate';
import { leggiUscite, scriviUscite } from './uscite';
import { randomUUID } from 'crypto';

const SPREADSHEET_ID = '1t8sY-JBkSDAnIBhQA_xwotRjxAzRCJ1XMUrxbpHlJpM';
// Nome del foglio di destinazione (tab) dentro il documento
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME ?? 'Prima Nota App';

// Colonne: ID | Tipo | Data | Descrizione | Categoria | Importo | CameraID | Note
const HEADER = ['ID', 'Tipo', 'Data', 'Descrizione', 'Categoria', 'Importo', 'CameraID', 'Note'];

// ── Mappa tipologia → categoria uscita ─────────────────────────────────────
const TIPO_USCITA: Record<string, Uscita['categoria']> = {
  'arredamento':    'Arredamento',
  'utenze':         'Utenze',
  'manutenzione':   'Manutenzione',
  'acquisti varie': 'Forniture',
  'spese varie':    'Forniture',
  'pulizie':        'Pulizie',
  'affitto':        'Affitto',
  'tasse':          'Tasse',
  'commissioni':    'Commissioni',
  'pubblicità':     'Pubblicità',
};

const STANZA_ID: Record<string, number> = {
  'bianca': 1, 'camera 1': 1, '1': 1,
  'gialla': 2, 'camera 2': 2, '2': 2,
  'rossa':  3, 'camera 3': 3, '3': 3,
  'verde':  4, 'camera 4': 4, '4': 4,
  'blue':   5, 'blu': 5, 'camera 5': 5, '5': 5,
};

function excelSerialToISO(serial: number): string {
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
}

function parseSheetDate(val: string | number | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'number') return excelSerialToISO(val);
  const s = String(val).trim();
  // già ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // gg/mm/aaaa o gg-mm-aaaa
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

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
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/** Restituisce il nome del foglio di destinazione, creandolo se non esiste. */
async function ensureSheet(sheets: ReturnType<typeof google.sheets>): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
  }
  return SHEET_NAME;
}

function entrataToRow(e: Entrata): string[] {
  return [e.id, 'entrata', e.data, e.descrizione, e.categoria, String(e.importo), String(e.camera_id ?? ''), e.note ?? ''];
}

function uscitaToRow(u: Uscita): string[] {
  return [u.id, 'uscita', u.data, u.descrizione, u.categoria, String(u.importo), String(u.camera_id ?? ''), u.note ?? ''];
}

async function getSheetsClient() {
  const auth = getAuth();
  const resolvedAuth = auth instanceof GoogleAuth ? await auth.getClient() : auth;
  return google.sheets({ version: 'v4', auth: resolvedAuth as never });
}

// ── Legge tutti i fogli mensili del documento originale e importa le uscite ──
async function importUsciteOriginale(
  sheets: ReturnType<typeof google.sheets>,
  uscite: Uscita[],
  keyUsc: Set<string>,
): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheets = meta.data.sheets ?? [];
  const now = new Date().toISOString();
  let importate = 0;

  for (const sheet of allSheets) {
    const sheetName = sheet.properties?.title ?? '';
    // Salta il foglio di export dell'app
    if (sheetName === SHEET_NAME) continue;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values ?? []) as (string | number)[][];

    // Trova la riga header con "Tipologia"
    const hIdx = rows.findIndex((r) => String(r[0] ?? '').trim() === 'Tipologia');
    if (hIdx === -1) continue;

    const ncols = rows[hIdx].length;
    const is2025 = ncols <= 12;

    const C = is2025
      ? { tipo: 0, desc: 1, uscite: 4, dataI: 6, dataF: 7, stanza: 9, note: 11 }
      : { tipo: 0, desc: 1, uscite: 4, dataI: 10, dataF: 11, stanza: 13, note: 15 };

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const tipo = String(row[C.tipo] ?? '').trim().toLowerCase();
      if (!tipo || tipo === 'tipologia' || tipo === 'debiti pregressi') continue;
      if (tipo.startsWith('ricavo')) continue; // solo uscite

      const desc   = String(row[C.desc]   ?? '').trim();
      const uscita = parseFloat(String(row[C.uscite] ?? '')) || 0;
      const dataI  = parseSheetDate(row[C.dataI] as string | number);
      const dataF  = parseSheetDate(row[C.dataF] as string | number);
      const stanza = String(row[C.stanza] ?? '').trim().toLowerCase();
      const note   = String(row[C.note]   ?? '').trim();

      if (uscita <= 0 || !desc) continue;
      const data = dataI ?? dataF;
      if (!data) continue;

      const k = `${data}|${desc}|${uscita}`;
      if (keyUsc.has(k)) continue;

      keyUsc.add(k);
      const cat = TIPO_USCITA[tipo] ?? 'Altro';
      const camera_id = STANZA_ID[stanza] ?? undefined;

      uscite.push({
        id: randomUUID(),
        data,
        descrizione: desc,
        categoria: cat,
        importo: uscita,
        camera_id,
        note,
        created_at: now,
      });
      importate++;
    }
  }

  return importate;
}

// ── App → Google Sheets ─────────────────────────────────────────────────────
export async function exportToSheets(): Promise<void> {
  const sheets = await getSheetsClient();
  const sheetName = await ensureSheet(sheets);
  const range = `'${sheetName}'!A:H`;

  const entrate = await leggiEntrate();
  const uscite  = await leggiUscite();

  const righe = [
    HEADER,
    ...[
      ...entrate.map(entrataToRow),
      ...uscite.map(uscitaToRow),
    ].sort((a, b) => b[2].localeCompare(a[2])),
  ];

  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: righe },
  });
}

// ── Google Sheets → App ─────────────────────────────────────────────────────
export async function importFromSheets(): Promise<{ importate: number; ignorate: number }> {
  const sheets  = await getSheetsClient();
  const uscite  = await leggiUscite();
  const entrate = await leggiEntrate();

  const keyUsc  = new Set(uscite.map((u) => `${u.data}|${u.descrizione}|${u.importo}`));
  const idsEntrate = new Set(entrate.map((e) => e.id));
  const idsUscite  = new Set(uscite.map((u) => u.id));

  let importate = 0;
  let ignorate  = 0;
  const now = new Date().toISOString();

  // 1. Legge il foglio "Prima Nota App" (export strutturato con ID)
  const sheetName = await ensureSheet(sheets);
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${sheetName}'!A:H` });
  const rows = res.data.values ?? [];

  for (const row of rows.slice(1).filter((r) => r[0] && r[1] && r[2] && r[3])) {
    const [id, tipo, data, descrizione, categoria, importoStr, cameraIdStr, note] = row;
    const importo   = parseFloat(importoStr) || 0;
    const camera_id = cameraIdStr ? parseInt(cameraIdStr) || undefined : undefined;

    if (tipo === 'entrata') {
      if (idsEntrate.has(id)) { ignorate++; continue; }
      const cat = CATEGORIE_ENTRATA.includes(categoria as never) ? categoria as Entrata['categoria'] : 'Altro';
      entrate.push({ id: id || randomUUID(), data, descrizione, categoria: cat, importo, camera_id, note: note ?? '', created_at: now });
      importate++;
    } else if (tipo === 'uscita') {
      if (idsUscite.has(id)) { ignorate++; continue; }
      const cat = CATEGORIE_USCITA.includes(categoria as never) ? categoria as Uscita['categoria'] : 'Altro';
      uscite.push({ id: id || randomUUID(), data, descrizione, categoria: cat, importo, camera_id, note: note ?? '', created_at: now });
      importate++;
    }
  }

  // 2. Legge i fogli mensili originali e importa le uscite nuove
  const nuoveUscite = await importUsciteOriginale(sheets, uscite, keyUsc);
  importate += nuoveUscite;

  await scriviEntrate(entrate);
  await scriviUscite(uscite);
  return { importate, ignorate };
}
