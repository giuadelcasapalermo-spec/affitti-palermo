const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const wb = XLSX.readFile('C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx');

// ── helpers ──────────────────────────────────────────────────────────────────

function excelToISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 10000) return null;
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
}

function normalizeStanza(sta) {
  return sta.toLowerCase().trim()
    .replace(/l{3,}/g, 'll')  // Giallla → gialla
    .replace(/\s+/g, '');
}

const STANZA_ID = { bianca:1, gialla:2, rossa:3, verde:4, blue:5, blu:5 };

// Tutti i fogli
const MESE_MAP = {
  Ottobre2025:  { anno: 2025, mese: 10 },
  Novembre2025: { anno: 2025, mese: 11 },
  Dicembre2025: { anno: 2025, mese: 12 },
  Gennaio:      { anno: 2026, mese: 1  },
  Febbraio:     { anno: 2026, mese: 2  },
  Marzo:        { anno: 2026, mese: 3  },
  Aprile:       { anno: 2026, mese: 4  },
  Maggio:       { anno: 2026, mese: 5  },
  Giugno:       { anno: 2026, mese: 6  },
  Luglio:       { anno: 2026, mese: 7  },
  Agosto:       { anno: 2026, mese: 8  },
  Settembre:    { anno: 2026, mese: 9  },
  Ottobre:      { anno: 2026, mese: 10 },
  Novembre:     { anno: 2026, mese: 11 },
  Dicembre:     { anno: 2026, mese: 12 },
};

function getCols(headerRow) {
  const isOld = headerRow.length <= 12 || String(headerRow[5]||'').toLowerCase().includes('ferrott');
  if (isOld) return { tip:0, des:1, ent:3, usc:4, tax:-1, di:6, df:7, sta:9, not:11 };
  return          { tip:0, des:1, ent:3, usc:4, tax:5,  di:10, df:11, sta:13, not:15 };
}

// Valida che la data sia plausibile per il mese del foglio (±3 mesi)
function dateOk(iso, info) {
  if (!iso) return false;
  const [y, m] = iso.split('-').map(Number);
  const diff = (y - info.anno) * 12 + (m - info.mese);
  return diff >= -3 && diff <= 3;
}

const TIPI_ENTRATA = new Set(['Ricavo Booking', 'Ricavo Privato', 'Ricavo AirBnb', 'Privato']);

// ── 1. IMPORTA DALL'EXCEL ────────────────────────────────────────────────────

const nuoveManuali = [];
const perMese = {};

for (const sheetName of wb.SheetNames) {
  const info = MESE_MAP[sheetName];
  if (!info) { process.stdout.write('  skip: ' + sheetName + '\n'); continue; }

  const ws   = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hi   = rows.findIndex(r => String(r[0]).trim() === 'Tipologia');
  if (hi < 0) continue;

  const C        = getCols(rows[hi]);
  const fallback = `${info.anno}-${String(info.mese).padStart(2,'0')}-15`;

  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const tip = String(row[C.tip] || '').trim();
    if (!TIPI_ENTRATA.has(tip)) continue;

    const ent = Number(row[C.ent]) || 0;
    if (ent === 0) continue;

    const tax  = C.tax >= 0 ? Number(row[C.tax]) || 0 : 0;
    const des  = String(row[C.des] || '').trim();
    const sta  = normalizeStanza(String(row[C.sta] || ''));
    const nota = String(row[C.not] || '').trim();

    const di_raw = excelToISO(row[C.di]);
    const df_raw = excelToISO(row[C.df]);
    const di = dateOk(di_raw, info) ? di_raw : fallback;
    const df = (df_raw && df_raw >= di && dateOk(df_raw, info)) ? df_raw : di;

    const pren = {
      id: randomUUID(),
      camera_id:      STANZA_ID[sta] ?? null,
      ospite_nome:    des || 'Ospite',
      ospite_telefono: '',
      ospite_email:   '',
      check_in:       di,
      check_out:      df,
      importo_totale: ent,
      stato:          'confermata',
      note:           [tip, nota].filter(Boolean).join(' — '),
      created_at:     new Date().toISOString(),
      fonte:          'manuale',
    };
    if (tax > 0) pren.tassa_soggiorno = tax;

    nuoveManuali.push(pren);

    const mk = di.slice(0, 7);
    if (!perMese[mk]) perMese[mk] = { n: 0, ent: 0, tax: 0 };
    perMese[mk].n++;
    perMese[mk].ent += ent;
    perMese[mk].tax += tax;
  }
}

// ── 2. MANTIENI iCal NON IN CONFLITTO ───────────────────────────────────────

const prenFile = path.join(__dirname, '../data/prenotazioni.json');
const vecchie  = JSON.parse(fs.readFileSync(prenFile, 'utf-8'));
const icalVecchi = vecchie.filter(p => p.fonte === 'ical');

const icalDaTenere = icalVecchi.filter(ic =>
  !nuoveManuali.some(m =>
    m.camera_id === ic.camera_id &&
    m.check_in  <  ic.check_out &&
    m.check_out >  ic.check_in
  )
);
const icalEliminati = icalVecchi.length - icalDaTenere.length;

// ── 3. SALVA ─────────────────────────────────────────────────────────────────

const finale = [...nuoveManuali, ...icalDaTenere];
fs.writeFileSync(prenFile, JSON.stringify(finale, null, 2));

// ── 4. REPORT ────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(`✓ Prenotazioni manuali importate : ${nuoveManuali.length}`);
console.log(`✓ Di cui con tassa di soggiorno  : ${nuoveManuali.filter(p=>p.tassa_soggiorno).length}`);
console.log(`✓ iCal conservati (no conflitto) : ${icalDaTenere.length}`);
console.log(`✓ iCal eliminati (duplicati)     : ${icalEliminati}`);
console.log(`✓ Totale prenotazioni salvate    : ${finale.length}`);
console.log('═══════════════════════════════════════\n');

console.log('Dettaglio per mese:');
Object.entries(perMese).sort(([a],[b]) => a.localeCompare(b)).forEach(([m, v]) => {
  const taxStr = v.tax > 0 ? `  TdS €${v.tax.toFixed(0)}` : '';
  console.log(`  ${m}  ${String(v.n).padStart(3)} prenotazioni  €${v.ent.toFixed(0)}${taxStr}`);
});
