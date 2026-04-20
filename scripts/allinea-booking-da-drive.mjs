/**
 * 1. Scarica "Prima nota GiuAdel 2025" da Google Drive come xlsx → cartella temp
 * 2. Per ogni riga "Ricavo Booking" nel foglio:
 *    - cerca una prenotazione esistente con stessa camera + check_in + check_out
 *    - se trovata: aggiorna ospite_nome e importo_totale
 * 3. Salva prenotazioni.json aggiornato
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '..');

// File già presente localmente (trovato in Documents)
const XLSX_PATH = process.argv[2] ??
  'C:/Users/Dario/Documents/Varie Dario/Immobili/Via Napoli 84/Affitto turistico/Pulizie/Prima nota GiuAdel 2025.xlsx';

console.log('Leggo:', XLSX_PATH);

// ── Helpers ─────────────────────────────────────────────
const STANZA_ID = {
  'bianca': 1, 'camera 1': 1, '1': 1,
  'gialla': 2, 'camera 2': 2, '2': 2,
  'rossa':  3, 'camera 3': 3, '3': 3,
  'verde':  4, 'camera 4': 4, '4': 4,
  'blue':   5, 'blu': 5, 'camera 5': 5, '5': 5,
};

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
}
function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') return excelDateToISO(val);
  const m = String(val).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

// ── Leggi prenotazioni ──────────────────────────────────
const PREN_PATH = resolve(ROOT, 'data', 'prenotazioni.json');
const prenotazioni = JSON.parse(readFileSync(PREN_PATH, 'utf-8'));

// ── Parsa xlsx e allinea ────────────────────────────────
const wb = XLSX.readFile(XLSX_PATH);
let aggiornate = 0, nonTrovate = 0, saltate = 0;

for (const sheetName of wb.SheetNames) {
  const ws   = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const hRow = rows.find(r => String(r[0]).trim() === 'Tipologia');
  if (!hRow) continue;

  const ncols  = hRow.length;
  const is2025 = ncols <= 12;

  const C = is2025 ? {
    tipo: 0, desc: 1, entrate: 3, tassa: -1, booking: -1,
    dataI: 6, dataF: 7, stanza: 9,
  } : {
    tipo: 0, desc: 1, entrate: 3, tassa: 5, booking: 6,
    dataI: 10, dataF: 11, stanza: 13,
  };

  for (const row of rows) {
    const tipo = String(row[C.tipo] ?? '').trim().toLowerCase();
    if (tipo !== 'ricavo booking') continue;

    const desc      = String(row[C.desc] ?? '').trim();
    const importo   = parseFloat(row[C.entrate]) || 0;
    const dataI     = parseDate(row[C.dataI]);
    const dataF     = parseDate(row[C.dataF]);
    const stanzaNome = String(row[C.stanza] ?? '').trim().toLowerCase();
    const cameraId  = STANZA_ID[stanzaNome];

    if (!dataI || !cameraId || importo <= 0) { saltate++; continue; }
    const checkOut = dataF ?? dataI;

    // Cerca prenotazione corrispondente (stessa camera + date)
    const match = prenotazioni.find(p =>
      p.camera_id === cameraId &&
      p.check_in  === dataI &&
      p.check_out === checkOut &&
      p.stato !== 'cancellata'
    );

    if (!match) {
      console.log(`  ✗ non trovata  cam${cameraId} ${dataI}→${checkOut}  ${desc}`);
      nonTrovate++;
      continue;
    }

    const vecchioNome   = match.ospite_nome;
    const vecchioImporto = match.importo_totale;
    match.ospite_nome    = desc || match.ospite_nome;
    match.importo_totale = importo;

    console.log(`  ✓ cam${cameraId} ${dataI}→${checkOut}  "${vecchioNome}" → "${match.ospite_nome}"  €${vecchioImporto}→€${importo}`);
    aggiornate++;
  }
}

writeFileSync(PREN_PATH, JSON.stringify(prenotazioni, null, 2));

console.log(`\n✅ Completato:`);
console.log(`   Prenotazioni aggiornate : ${aggiornate}`);
console.log(`   Non trovate nel DB      : ${nonTrovate}`);
console.log(`   Saltate (dati mancanti) : ${saltate}`);
