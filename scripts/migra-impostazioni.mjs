/**
 * Migra impostazioni.json → tab "Impostazioni" su Google Sheets.
 * Uso: node scripts/migra-impostazioni.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

// ── Carica .env.local ─────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, '.env.local');
  if (!existsSync(envPath)) throw new Error('.env.local non trovato');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
}
loadEnv();

const SPREADSHEET_ID = '1t8sY-JBkSDAnIBhQA_xwotRjxAzRCJ1XMUrxbpHlJpM';
const IMP_SHEET      = 'Impostazioni';

// ── Auth ──────────────────────────────────────────────────────────────────
function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    return oauth2;
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Credenziali Google non trovate in .env.local');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
const impPath = resolve(ROOT, 'data', 'impostazioni.json');
const imp = existsSync(impPath)
  ? JSON.parse(readFileSync(impPath, 'utf-8'))
  : { ical_urls: {}, nomi_camere: { 1:'Rossa', 2:'Gialla', 3:'Verde', 4:'Bianca', 5:'Blue' } };

console.log('Impostazioni lette:', JSON.stringify(imp, null, 2));

const auth   = getAuth();
const sheets = google.sheets({ version: 'v4', auth });

// Crea il tab se non esiste
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const exists = meta.data.sheets?.some(s => s.properties?.title === IMP_SHEET);
if (!exists) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: IMP_SHEET } } }] },
  });
  console.log(`Tab "${IMP_SHEET}" creato.`);
}

// Costruisci righe
const rows = [['Tipo', 'ID', 'Valore']];
for (const [id, nome] of Object.entries(imp.nomi_camere ?? {})) {
  rows.push(['camera', id, nome]);
}
for (const [id, url] of Object.entries(imp.ical_urls ?? {})) {
  rows.push(['ical', id, url ?? '']);
}
if (imp.ultimo_sync) {
  rows.push(['sync', 'ultimo_sync', imp.ultimo_sync]);
}

// Scrivi sul foglio
await sheets.spreadsheets.values.clear({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${IMP_SHEET}'!A:C`,
});
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${IMP_SHEET}'!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: rows },
});

console.log(`\nScritte ${rows.length - 1} righe nel tab "${IMP_SHEET}". Fatto!`);
