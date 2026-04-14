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

function getAuth() {
  // Modalità OAuth2 (se configurata)
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  // Modalità Service Account (fallback)
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
  // GoogleAuth ha getClient(), OAuth2Client è già un auth diretto
  const resolvedAuth = auth instanceof GoogleAuth ? await auth.getClient() : auth;
  return google.sheets({ version: 'v4', auth: resolvedAuth as never });
}

// App → Google Sheets
export async function exportToSheets(): Promise<void> {
  const sheets = await getSheetsClient();
  const sheetName = await ensureSheet(sheets);
  const range = `'${sheetName}'!A:H`;

  const entrate = await leggiEntrate();
  const uscite = await leggiUscite();

  const righe = [
    HEADER,
    ...[
      ...entrate.map(entrataToRow),
      ...uscite.map(uscitaToRow),
    ].sort((a, b) => b[2].localeCompare(a[2])), // ordine data desc
  ];

  // Cancella e riscrivi
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: righe },
  });
}

// Google Sheets → App
export async function importFromSheets(): Promise<{ importate: number; ignorate: number }> {
  const sheets = await getSheetsClient();
  const sheetName = await ensureSheet(sheets);
  const range = `'${sheetName}'!A:H`;

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = res.data.values ?? [];
  if (rows.length < 2) return { importate: 0, ignorate: 0 };

  // Salta header
  const dataRows = rows.slice(1).filter((r) => r[0] && r[1] && r[2] && r[3]);

  const entrate = await leggiEntrate();
  const uscite = await leggiUscite();
  const idsEntrate = new Set(entrate.map((e) => e.id));
  const idsUscite = new Set(uscite.map((u) => u.id));

  let importate = 0;
  let ignorate = 0;

  for (const row of dataRows) {
    const [id, tipo, data, descrizione, categoria, importoStr, cameraIdStr, note] = row;
    const importo = parseFloat(importoStr) || 0;
    const camera_id = cameraIdStr ? parseInt(cameraIdStr) || undefined : undefined;
    const now = new Date().toISOString();

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

  await scriviEntrate(entrate);
  await scriviUscite(uscite);
  return { importate, ignorate };
}
