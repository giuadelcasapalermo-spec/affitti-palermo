/**
 * sync-entrate-ical.mjs
 * 1. Importa (o aggiorna) le entrate dalla tab "Prima Nota App" di Google Sheets
 * 2. Inserisce nel DB le prenotazioni iCal mancanti (comprese quelle passate)
 *
 * Esegui con: node scripts/sync-entrate-ical.mjs
 */

import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const sql = neon(process.env.DATABASE_URL);
const SHEET_FALLBACK = '1t8sY-JBkSDAnIBhQA_xwotRjxAzRCJ1XMUrxbpHlJpM';
const SHEET_TAB = process.env.GOOGLE_SHEET_NAME ?? 'Prima Nota App';

// ══════════════════════════════════════════════════════════════════════════════
// 1. ENTRATE da Google Sheets → DB
// ══════════════════════════════════════════════════════════════════════════════

async function importaEntrate() {
  console.log('\n═══ Import entrate da Google Sheets ═══');

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: 'v4', auth: oauth2 });

  // Leggi sheet ID configurato nel DB (o usa fallback)
  const cfg = await sql`SELECT chiave, valore FROM impostazioni WHERE tipo = 'config'`;
  const sheetId = cfg.find(r => r.chiave === 'google_sheet_id')?.valore?.trim() || SHEET_FALLBACK;
  console.log(`  Sheet ID: ${sheetId}`);
  console.log(`  Tab:      ${SHEET_TAB}`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${SHEET_TAB}'!A:H`,
  });

  const rows = (res.data.values ?? []).slice(1); // salta header
  const now = new Date().toISOString();
  let processate = 0;
  let saltate = 0;

  for (const row of rows) {
    const [id, tipo, data, descrizione, categoria, importoStr, cameraIdStr, note] = row;
    if (tipo !== 'entrata') { saltate++; continue; }
    if (!data || !descrizione) continue;

    const importo   = parseFloat(importoStr)  || 0;
    const camera_id = cameraIdStr ? (parseInt(cameraIdStr) || null) : null;
    const entId     = id?.trim() || randomUUID();

    await sql`
      INSERT INTO entrate (id, data, descrizione, categoria, importo, camera_id, note, created_at)
      VALUES (
        ${entId}, ${data}, ${descrizione}, ${categoria || 'Altro'},
        ${importo}, ${camera_id}, ${note || ''}, ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        data         = EXCLUDED.data,
        descrizione  = EXCLUDED.descrizione,
        categoria    = EXCLUDED.categoria,
        importo      = EXCLUDED.importo,
        camera_id    = EXCLUDED.camera_id,
        note         = EXCLUDED.note
    `;
    processate++;
    console.log(`  ✓ ${data}  ${descrizione.padEnd(30)}  €${importo.toFixed(2)}`);
  }

  console.log(`\n  Processate: ${processate}  |  Saltate (non-entrata): ${saltate}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. iCal → DB (prenotazioni mancanti)
// ══════════════════════════════════════════════════════════════════════════════

function parseIcalDate(val) {
  const clean = val.replace(/[TZ]/g, '');
  const y  = parseInt(clean.slice(0, 4));
  const mo = parseInt(clean.slice(4, 6)) - 1;
  const d  = parseInt(clean.slice(6, 8));
  return new Date(y, mo, d);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIcal(text) {
  const events = [];
  const lines = text
    .replace(/\r\n /g, '')
    .replace(/\r\n\t/g, '')
    .split(/\r?\n/);

  let inEvent = false, uid = '', start = null, end = null, summary = '';
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true; uid = ''; start = null; end = null; summary = '';
    } else if (line === 'END:VEVENT') {
      if (uid && start && end) events.push({ uid, start, end, summary });
      inEvent = false;
    } else if (!inEvent) {
      continue;
    } else if (line.startsWith('UID:')) {
      uid = line.slice(4).trim();
    } else if (line.startsWith('DTSTART')) {
      start = parseIcalDate(line.split(':').slice(1).join(':').trim());
    } else if (line.startsWith('DTEND')) {
      end = parseIcalDate(line.split(':').slice(1).join(':').trim());
    } else if (line.startsWith('SUMMARY:')) {
      summary = line.slice(8).trim();
    }
  }
  return events;
}

async function syncIcal() {
  console.log('\n═══ Sync iCal (prenotazioni mancanti) ═══');
  const today = new Date().toISOString().split('T')[0];

  const impRows = await sql`SELECT chiave, valore FROM impostazioni WHERE tipo = 'ical'`;
  if (impRows.length === 0) {
    console.log('  Nessun URL iCal configurato.');
    return;
  }

  // Carica tutti gli ical_uid già presenti nel DB
  const uidRows = await sql`SELECT ical_uid FROM prenotazioni WHERE ical_uid IS NOT NULL`;
  const uidEsistenti = new Set(uidRows.map(r => r.ical_uid));

  let totaleAggiunte = 0;

  for (const { chiave, valore: url } of impRows) {
    const cameraId = Number(chiave);
    if (!url?.trim()) continue;

    console.log(`\n  Camera ${cameraId}:`);
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CalendarBot/1.0)',
          'Accept': 'text/calendar, */*',
        },
      });
      if (!res.ok) { console.log(`    ✗ HTTP ${res.status}`); continue; }

      const eventi = parseIcal(await res.text());
      const now    = new Date().toISOString();
      let aggiunte = 0;

      for (const ev of eventi) {
        if (uidEsistenti.has(ev.uid)) continue;

        const checkIn  = formatDate(ev.start);
        const checkOut = formatDate(ev.end);
        const sl       = ev.summary.toLowerCase();
        const nome     = (ev.summary &&
          !sl.includes('closed') &&
          !sl.includes('blocked') &&
          !sl.includes('not available'))
          ? ev.summary
          : 'Ospite Booking.com';

        const id = randomUUID();
        await sql`
          INSERT INTO prenotazioni
            (id, camera_id, ospite_nome, ospite_telefono, ospite_email,
             check_in, check_out, importo_totale, stato, note, created_at, fonte, ical_uid)
          VALUES
            (${id}, ${cameraId}, ${nome}, '', '',
             ${checkIn}, ${checkOut}, 0, 'confermata',
             'Importata da iCal', ${now}, 'ical', ${ev.uid})
        `;

        uidEsistenti.add(ev.uid);
        const tag = checkIn < today ? '(passata)' : '';
        console.log(`    + ${checkIn} → ${checkOut}  ${nome} ${tag}`);
        aggiunte++;
      }

      if (aggiunte === 0) {
        console.log(`    ✓ Nessuna nuova (${eventi.length} eventi nel feed)`);
      } else {
        console.log(`    ✓ Aggiunte: ${aggiunte} su ${eventi.length} eventi`);
      }
      totaleAggiunte += aggiunte;

    } catch (err) {
      console.log(`    ✗ Errore: ${err.message}`);
    }
  }

  console.log(`\n  Totale nuove prenotazioni iCal: ${totaleAggiunte}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const ts = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  sync-entrate-ical  ${ts.padEnd(13)}║`);
  console.log(`╚══════════════════════════════════╝`);

  try {
    await importaEntrate();
  } catch (err) {
    console.error('\n✗ Errore import entrate:', err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
  }

  try {
    await syncIcal();
  } catch (err) {
    console.error('\n✗ Errore sync iCal:', err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
  }

  console.log('\n╔══════════════════════════════════╗');
  console.log('║  Completato                      ║');
  console.log('╚══════════════════════════════════╝\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
