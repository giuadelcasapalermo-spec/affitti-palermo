/**
 * Importa dati da "Prima nota GiuAdel 2025.xlsx"
 * → data/prenotazioni.json  (Ricavo Booking / Ricavo Privato / Ricavo AirBnb)
 * → data/entrate.json       (stessi ricavi, come entrate nella Prima Nota)
 * → data/uscite.json        (tutte le spese)
 *
 * Uso: node scripts/importa-excel.mjs [percorso-excel]
 */

import XLSX from 'xlsx';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const excelPath = process.argv[2] ?? 'C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx';

// ── Mappa stanza nome → ID ─────────────────────────────────────
const STANZA_ID = {
  'bianca': 1, 'camera 1': 1, '1': 1,
  'gialla': 2, 'camera 2': 2, '2': 2,
  'rossa':  3, 'camera 3': 3, '3': 3,
  'verde':  4, 'camera 4': 4, '4': 4,
  'blue':   5, 'blu': 5, 'camera 5': 5, '5': 5,
};

// ── Mappa tipologia → categoria uscita ────────────────────────
const TIPO_USCITA = {
  'arredamento': 'Arredamento',
  'utenze': 'Utenze',
  'manutenzione': 'Manutenzione',
  'acquisti varie': 'Forniture',
  'spese varie': 'Forniture',
  'pulizie': 'Pulizie',
  'affitto': 'Affitto',
  'tasse': 'Tasse',
  'commissioni': 'Commissioni',
};

// ── Mappa tipologia → categoria entrata ───────────────────────
const TIPO_ENTRATA = {
  'ricavo booking': 'Booking.com',
  'ricavo privato': 'Privato',
  'ricavo airbnb':  'Airbnb',
};

// ── Converti serial Excel → 'YYYY-MM-DD' ──────────────────────
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  // Excel epoch: 1 gennaio 1900 = 1, ma Excel sbaglia il 1900 come bisestile (+ 1)
  const utcDays = serial - 25569; // giorni da Unix epoch (1 gen 1970)
  const ms = utcDays * 86400 * 1000;
  const d = new Date(ms);
  return d.toISOString().split('T')[0];
}

// ── Converti una data testuale o serial → 'YYYY-MM-DD' ────────
function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') return excelDateToISO(val);
  // es. "15/10/2025"
  const m = String(val).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

// ── Leggi JSON esistente ───────────────────────────────────────
function leggi(file) {
  const p = resolve(ROOT, 'data', file);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function scrivi(file, data) {
  const p = resolve(ROOT, 'data', file);
  writeFileSync(p, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
console.log('Leggo:', excelPath);
const wb = XLSX.readFile(excelPath);

const prenotazioni = leggi('prenotazioni.json');
const entrate      = leggi('entrate.json');
const uscite       = leggi('uscite.json');

// Chiavi per deduplicare
const keyPren = new Set(prenotazioni.map(p =>
  `${p.ospite_nome}|${p.check_in}|${p.check_out}|${p.camera_id}`));
const keyEntr = new Set(entrate.map(e =>
  `${e.data}|${e.descrizione}|${e.importo}|${e.camera_id ?? ''}`));
const keyUsc  = new Set(uscite.map(u =>
  `${u.data}|${u.descrizione}|${u.importo}`));

let cntPren = 0, cntEntr = 0, cntUsc = 0, cntSkip = 0;

const now = new Date().toISOString();

for (const sheetName of wb.SheetNames) {
  const ws   = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Determina offset colonne: fogli con 16 col (2026) vs 12 col (2025)
  // Header row contiene "Tipologia"
  let hRow = rows.find(r => String(r[0]).trim() === 'Tipologia');
  if (!hRow) continue;

  const ncols = hRow.length;
  const is2025 = ncols <= 12; // fogli Ottobre2025, Novembre2025, Dicembre2025

  // Indici colonne
  const C = is2025 ? {
    tipo: 0, desc: 1, entrate: 3, uscite: 4,
    tassa: -1, booking: -1,
    dataI: 6, dataF: 7,
    fornitore: 8, stanza: 9, note: 11,
  } : {
    tipo: 0, desc: 1, entrate: 3, uscite: 4,
    tassa: 5, booking: 6,
    dataI: 10, dataF: 11,
    fornitore: 12, stanza: 13, note: 15,
  };

  for (const row of rows) {
    const tipo = String(row[C.tipo] ?? '').trim().toLowerCase();
    const desc = String(row[C.desc] ?? '').trim();

    if (!tipo || tipo === 'tipologia' || tipo === 'debiti pregressi') continue;

    const entrata = parseFloat(row[C.entrate]) || 0;
    const uscita  = parseFloat(row[C.uscite])  || 0;
    const tassa   = C.tassa >= 0 ? parseFloat(row[C.tassa]) || 0 : 0;
    const booking = C.booking >= 0 ? parseFloat(row[C.booking]) || 0 : 0;
    const dataI   = parseDate(row[C.dataI]);
    const dataF   = parseDate(row[C.dataF]);
    const fornitore = String(row[C.fornitore] ?? '').trim();
    const stanzaNome = String(row[C.stanza] ?? '').trim().toLowerCase();
    const note    = String(row[C.note] ?? '').trim();
    const cameraId = STANZA_ID[stanzaNome] ?? undefined;

    // ── RICAVI → Prenotazione + Entrata ────────────────────────
    const isRicavo = tipo.startsWith('ricavo');
    if (isRicavo && entrata > 0 && dataI) {
      const checkOut = dataF ?? dataI;

      // Determina importo: usa "booking" se disponibile, altrimenti entrata
      const importoTotale = booking > 0 ? booking : entrata;

      // Determina fonte
      let fonte = 'Privato';
      if (tipo.includes('booking') || fornitore.toLowerCase().includes('booking')) fonte = 'Booking.com';
      else if (tipo.includes('airbnb') || fornitore.toLowerCase().includes('airbnb')) fonte = 'Airbnb';
      else if (fornitore.toLowerCase().includes('ferrotti')) fonte = 'Privato';

      const catEntrata = TIPO_ENTRATA[tipo] ?? 'Privato';

      // Prenotazione
      if (dataI && checkOut) {
        const kp = `${desc}|${dataI}|${checkOut}|${cameraId}`;
        if (!keyPren.has(kp)) {
          keyPren.add(kp);
          prenotazioni.push({
            id: randomUUID(),
            camera_id: cameraId ?? 0,
            ospite_nome: desc,
            ospite_telefono: '',
            ospite_email: '',
            check_in: dataI,
            check_out: checkOut,
            importo_totale: importoTotale,
            tassa_soggiorno: tassa || undefined,
            stato: 'confermata',
            note,
            created_at: now,
            fonte: fonte === 'Booking.com' ? 'manuale' : 'manuale',
          });
          cntPren++;
        } else { cntSkip++; }
      }

      // Entrata (Prima Nota)
      const ke = `${dataI}|${desc}|${entrata}|${cameraId ?? ''}`;
      if (!keyEntr.has(ke)) {
        keyEntr.add(ke);
        entrate.push({
          id: randomUUID(),
          data: dataI,
          descrizione: desc,
          categoria: catEntrata,
          importo: entrata,
          camera_id: cameraId,
          note,
          created_at: now,
        });
        cntEntr++;
      }
    }

    // ── USCITE ──────────────────────────────────────────────────
    if (!isRicavo && uscita > 0 && desc) {
      const dataUsc = dataI ?? dataF;
      if (!dataUsc) { cntSkip++; continue; }

      const catRaw  = tipo.toLowerCase();
      const catUsc  = TIPO_USCITA[catRaw] ?? 'Altro';

      const ku = `${dataUsc}|${desc}|${uscita}`;
      if (!keyUsc.has(ku)) {
        keyUsc.add(ku);
        uscite.push({
          id: randomUUID(),
          data: dataUsc,
          descrizione: desc,
          categoria: catUsc,
          importo: uscita,
          camera_id: cameraId,
          note,
          created_at: now,
        });
        cntUsc++;
      } else { cntSkip++; }
    }
  }
}

scrivi('prenotazioni.json', prenotazioni);
scrivi('entrate.json', entrate);
scrivi('uscite.json', uscite);

console.log(`\n✅ Importazione completata:`);
console.log(`   Prenotazioni aggiunte : ${cntPren}`);
console.log(`   Entrate aggiunte      : ${cntEntr}`);
console.log(`   Uscite aggiunte       : ${cntUsc}`);
console.log(`   Righe saltate (dup.)  : ${cntSkip}`);
console.log(`\nTotali nel database:`);
console.log(`   Prenotazioni : ${prenotazioni.length}`);
console.log(`   Entrate      : ${entrate.length}`);
console.log(`   Uscite       : ${uscite.length}`);
