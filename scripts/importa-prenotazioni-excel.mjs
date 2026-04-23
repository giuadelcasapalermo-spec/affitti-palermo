/**
 * importa-prenotazioni-excel.mjs
 * Legge i file Excel "Prima nota GiuAdel", confronta con il DB Neon e:
 *  - INSERISCE le prenotazioni mancanti (check_in < oggi)
 *  - AGGIORNA quelle esistenti con nome generico o importo 0
 *
 * Esegui con: node scripts/importa-prenotazioni-excel.mjs
 */

import XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const sql = neon(process.env.DATABASE_URL);

// ── Mapping corretto camere (da memoria verificata) ───────────────────────────
// 1=Rossa, 2=Gialla, 3=Verde, 4=Bianca, 5=Blue
const STANZA_ID = {
  'rossa':   1, 'camera 1': 1,
  'gialla':  2, 'giallla': 2, 'camera 2': 2,
  'verde':   3, 'camera 3': 3,
  'bianca':  4, 'bianca)': 4, 'camera 4': 4,
  'blue':    5, 'blu': 5, 'camera 5': 5,
};

function stanzaToId(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (STANZA_ID[s] !== undefined) return STANZA_ID[s];
  for (const [k, v] of Object.entries(STANZA_ID)) {
    if (s.includes(k)) return v;
  }
  return null;
}

// ── Parsing data Excel ────────────────────────────────────────────────────────
function excelToISO(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    if (val < 10000 || val > 100000) return null;
    const d = new Date((val - 25569) * 86400 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ── Rilevamento formato colonne ───────────────────────────────────────────────
function getCols(headerRow) {
  const ncols = headerRow.length;
  const col5  = String(headerRow[5] ?? '').toLowerCase();
  const isOld = ncols <= 12 || col5.includes('ferrott') || col5.includes('entrata netta');
  return isOld
    ? { tip:0, des:1, ent:3, tax:-1, di:6, df:7, sta:9, not:11 }
    : { tip:0, des:1, ent:3, tax:5,  di:10, df:11, sta:13, not:15 };
}

// ── Tipi da considerare come prenotazioni ─────────────────────────────────────
const TIPI_PREN = new Set([
  'ricavo booking', 'ricavo privato', 'ricavo airbnb', 'privato', 'affitto',
]);

// ── Leggi righe da un file Excel ──────────────────────────────────────────────
function leggiRigheExcel(filePath, annoDefault) {
  console.log(`\n  File: ${filePath}`);
  if (!fs.existsSync(filePath)) {
    console.log('  ✗ File non trovato, saltato.');
    return [];
  }

  const wb   = XLSX.readFile(filePath);
  const righe = [];

  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const hi = rows.findIndex(r => String(r[0]).trim() === 'Tipologia');
    if (hi < 0) continue;

    const C = getCols(rows[hi]);

    // Deduce anno dal nome del foglio
    let anno = annoDefault;
    const match2025 = sheetName.match(/2025/);
    const match2024 = sheetName.match(/2024/);
    if (match2025) anno = 2025;
    else if (match2024) anno = 2024;

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      const tipo = String(row[C.tip] ?? '').trim().toLowerCase();
      if (!TIPI_PREN.has(tipo)) continue;

      const nome   = String(row[C.des] ?? '').trim();
      const ent    = parseFloat(row[C.ent]) || 0;
      const tax    = C.tax >= 0 ? (parseFloat(row[C.tax]) || 0) : 0;
      const stanza = String(row[C.sta] ?? '').trim();
      const nota   = String(row[C.not] ?? '').trim();
      const di     = excelToISO(row[C.di]);
      const df     = excelToISO(row[C.df]);

      const cameraId = stanzaToId(stanza);
      if (!di || !cameraId) continue;

      // Correggi anno se la data cade fuori dal range atteso
      let checkIn = di;
      const [y] = di.split('-').map(Number);
      if (y !== anno && Math.abs(y - anno) > 1) {
        checkIn = di.replace(/^\d{4}/, String(anno));
      }

      righe.push({
        foglio: sheetName,
        tipo: row[C.tip]?.trim(),
        nome,
        importo: ent,
        tassa: tax,
        checkIn,
        checkOut: df ?? checkIn,
        cameraId,
        nota,
      });
    }
  }

  console.log(`  Righe prenotazione trovate: ${righe.length}`);
  return righe;
}

// ── AddDay ────────────────────────────────────────────────────────────────────
function addDay(iso, n = 1) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const oggi = new Date().toISOString().split('T')[0];
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Import prenotazioni da Excel  (oggi: ${oggi})  ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  // ── Leggi tutti i file Excel disponibili ──────────────────────────────────
  const FILE_EXCEL = [
    { path: 'C:/Users/Dario/Documents/Varie Dario/Immobili/Via Napoli 84/Affitto turistico/Prima nota GiuAdel 2026.xlsx', anno: 2026 },
    { path: 'C:/Users/Dario/Documents/Varie Dario/Immobili/Via Napoli 84/Affitto turistico/Pulizie/Prima nota GiuAdel 2025.xlsx', anno: 2025 },
  ];

  console.log('\n─── Lettura Excel ───');
  let righeExcel = [];
  for (const f of FILE_EXCEL) {
    righeExcel = righeExcel.concat(leggiRigheExcel(f.path, f.anno));
  }

  // Filtra: solo gen-feb 2026
  const righePassato = righeExcel.filter(r => r.checkIn >= '2026-01-01' && r.checkIn < '2026-03-01');
  console.log(`\nRighe totali: ${righeExcel.length}  |  Filtrate gen-feb 2026: ${righePassato.length}`);

  if (righePassato.length === 0) {
    console.log('Nessuna riga trovata. Fine.');
    process.exit(0);
  }

  // ── Leggi prenotazioni dal DB ──────────────────────────────────────────────
  console.log('\n─── DB: carico prenotazioni esistenti ───');
  const dbPren = await sql`
    SELECT id, camera_id, ospite_nome, check_in, check_out, importo_totale, tassa_soggiorno, stato
    FROM prenotazioni
    WHERE stato != 'cancellata'
    ORDER BY check_in
  `;
  console.log(`  Prenotazioni nel DB (non cancellate): ${dbPren.length}`);

  // ── Matching Excel → DB ───────────────────────────────────────────────────
  console.log('\n─── Confronto e importazione ───');
  const now = new Date().toISOString();

  let inserite  = 0;
  let aggiornate = 0;
  let saltateDuplicate = 0;

  for (const riga of righePassato) {
    // Cerca match per camera_id + check_in (esatto o ±1 giorno)
    const candidateDate = [riga.checkIn, addDay(riga.checkIn, 1), addDay(riga.checkIn, -1)];
    const match = dbPren.find(p =>
      p.camera_id === riga.cameraId &&
      candidateDate.includes(p.check_in)
    );

    if (match) {
      // Esiste: aggiorna se nome generico o importo mancante
      const nomeGenerico = !match.ospite_nome || match.ospite_nome === 'Ospite Booking.com';
      const importoMancante = !match.importo_totale || Number(match.importo_totale) === 0;

      if ((nomeGenerico && riga.nome) || importoMancante) {
        const nuovoNome    = (nomeGenerico && riga.nome) ? riga.nome : match.ospite_nome;
        const nuovoImporto = importoMancante && riga.importo > 0 ? riga.importo : Number(match.importo_totale);
        const nuovaTassa   = (riga.tassa > 0 && !match.tassa_soggiorno) ? riga.tassa : (match.tassa_soggiorno ?? null);

        await sql`
          UPDATE prenotazioni
          SET ospite_nome = ${nuovoNome}, importo_totale = ${nuovoImporto}, tassa_soggiorno = ${nuovaTassa}
          WHERE id = ${match.id}
        `;
        // Aggiorna cache locale
        match.ospite_nome    = nuovoNome;
        match.importo_totale = nuovoImporto;

        console.log(`  ≈ AGGIORNATA  ${riga.checkIn}  cam${riga.cameraId}  ${nuovoNome}  €${nuovoImporto}${nuovaTassa ? `  TdS€${nuovaTassa}` : ''}`);
        aggiornate++;
      } else {
        saltateDuplicate++;
      }
      continue;
    }

    // Non trovata: inserisci
    const id = randomUUID();
    await sql`
      INSERT INTO prenotazioni
        (id, camera_id, ospite_nome, ospite_telefono, ospite_email,
         check_in, check_out, importo_totale, tassa_soggiorno,
         stato, note, created_at, fonte, ical_uid)
      VALUES
        (${id}, ${riga.cameraId}, ${riga.nome || 'Ospite'}, '', '',
         ${riga.checkIn}, ${riga.checkOut}, ${riga.importo},
         ${riga.tassa > 0 ? riga.tassa : null},
         'confermata',
         ${[riga.tipo, riga.nota].filter(Boolean).join(' — ') || 'Importata da Excel'},
         ${now}, 'manuale', null)
    `;

    // Aggiungi alla cache locale per evitare duplicati nella stessa sessione
    dbPren.push({
      id, camera_id: riga.cameraId, ospite_nome: riga.nome,
      check_in: riga.checkIn, check_out: riga.checkOut,
      importo_totale: riga.importo, tassa_soggiorno: riga.tassa || null, stato: 'confermata',
    });

    console.log(`  + INSERITA    ${riga.checkIn}→${riga.checkOut}  cam${riga.cameraId}  ${riga.nome || 'Ospite'}  €${riga.importo}${riga.tassa ? `  TdS€${riga.tassa}` : ''}  [${riga.foglio}]`);
    inserite++;
  }

  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  RIEPILOGO                       ║`);
  console.log(`║  Inserite:   ${String(inserite).padEnd(20)}║`);
  console.log(`║  Aggiornate: ${String(aggiornate).padEnd(20)}║`);
  console.log(`║  Già OK:     ${String(saltateDuplicate).padEnd(20)}║`);
  console.log(`╚══════════════════════════════════╝\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
