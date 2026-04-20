/**
 * Importa come entrate solo le righe "Ricavo Privato"
 * con data check-in ≤ 2026-04-30
 */
import XLSX from 'xlsx';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const excelPath = process.argv[2] ?? 'C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx';
const DATA_LIMITE = '2026-04-30';

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const utcDays = serial - 25569;
  const d = new Date(utcDays * 86400 * 1000);
  return d.toISOString().split('T')[0];
}
function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') return excelDateToISO(val);
  const m = String(val).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

const PATH_ENTRATE = resolve(ROOT, 'data', 'entrate.json');
const entrate = existsSync(PATH_ENTRATE)
  ? JSON.parse(readFileSync(PATH_ENTRATE, 'utf-8'))
  : [];

// Chiave deduplicazione
const keyEntr = new Set(entrate.map(e =>
  `${e.data}|${e.descrizione}|${e.importo}`));

console.log('Leggo:', excelPath);
const wb = XLSX.readFile(excelPath);

let aggiunte = 0, saltate = 0;
const now = new Date().toISOString();

for (const sheetName of wb.SheetNames) {
  const ws   = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const hRow = rows.find(r => String(r[0]).trim() === 'Tipologia');
  if (!hRow) continue;

  const ncols = hRow.length;
  const is2025 = ncols <= 12;

  const C = is2025 ? {
    tipo: 0, desc: 1, entrate: 3, dataI: 6, stanza: 9, note: 11,
  } : {
    tipo: 0, desc: 1, entrate: 3, dataI: 10, stanza: 13, note: 15,
  };

  const STANZA_ID = {
    'bianca': 1, 'camera 1': 1, '1': 1,
    'gialla': 2, 'camera 2': 2, '2': 2,
    'rossa':  3, 'camera 3': 3, '3': 3,
    'verde':  4, 'camera 4': 4, '4': 4,
    'blue':   5, 'blu': 5, 'camera 5': 5, '5': 5,
  };

  for (const row of rows) {
    const tipo = String(row[C.tipo] ?? '').trim().toLowerCase();
    if (tipo !== 'ricavo privato') continue;

    const desc     = String(row[C.desc] ?? '').trim();
    const entrata  = parseFloat(row[C.entrate]) || 0;
    const dataI    = parseDate(row[C.dataI]);
    const stanzaNome = String(row[C.stanza] ?? '').trim().toLowerCase();
    const note     = String(row[C.note] ?? '').trim();
    const cameraId = STANZA_ID[stanzaNome] ?? undefined;

    if (!dataI || entrata <= 0) { saltate++; continue; }
    if (dataI > DATA_LIMITE)    { saltate++; continue; }

    const k = `${dataI}|${desc}|${entrata}`;
    if (keyEntr.has(k)) { saltate++; continue; }

    keyEntr.add(k);
    entrate.push({
      id: randomUUID(),
      data: dataI,
      descrizione: desc,
      categoria: 'Privato',
      importo: entrata,
      camera_id: cameraId,
      note,
      created_at: now,
    });
    aggiunte++;
    console.log(`  + ${dataI}  ${desc.padEnd(30)}  €${entrata}`);
  }
}

writeFileSync(PATH_ENTRATE, JSON.stringify(entrate, null, 2));
console.log(`\n✅ Ricavi Privati ≤ ${DATA_LIMITE}:`);
console.log(`   Aggiunte : ${aggiunte}`);
console.log(`   Saltate  : ${saltate}  (già presenti o senza data/importo)`);
console.log(`   Totale entrate nel DB: ${entrate.length}`);
