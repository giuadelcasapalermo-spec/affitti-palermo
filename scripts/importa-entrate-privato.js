const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const wb = XLSX.readFile('C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx');

function excelToISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 10000) return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split('T')[0];
}

// Tutti i fogli disponibili
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

const STANZA_ID = {
  Bianca: 1, bianca: 1,
  Gialla: 2, gialla: 2,
  Rossa:  3, rossa:  3,
  Verde:  4, verde:  4,
  Blue:   5, blue:   5, Blu: 5,
};

function getCols(headerRow) {
  const isOld = (headerRow.length <= 12) || (String(headerRow[5] || '').toLowerCase().includes('ferrott'));
  if (isOld) {
    return { tip: 0, des: 1, ent: 3, di: 6, sta: 9, not: 11 };
  }
  return { tip: 0, des: 1, ent: 3, di: 10, sta: 13, not: 15 };
}

const entrate = [];

for (const sheetName of wb.SheetNames) {
  const info = MESE_MAP[sheetName];
  if (!info) continue;

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const headerIdx = rows.findIndex(r => String(r[0]).trim() === 'Tipologia');
  if (headerIdx < 0) { console.log(`  [${sheetName}] intestazione non trovata`); continue; }
  const C = getCols(rows[headerIdx]);

  const fallback = `${info.anno}-${String(info.mese).padStart(2, '0')}-15`;

  let trovate = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const tip = String(row[C.tip] || '').trim();
    if (tip !== 'Ricavo Privato' && tip !== 'Privato') continue;

    const importo = Number(row[C.ent]) || 0;
    if (importo === 0) continue;

    const des      = String(row[C.des] || '').trim();
    const sta      = String(row[C.sta] || '').trim();
    const nota     = String(row[C.not] || '').trim();
    const data     = excelToISO(row[C.di]) || fallback;
    const cameraId = STANZA_ID[sta];

    const entry = {
      id: randomUUID(),
      data,
      descrizione: des || 'Ricavo Privato',
      categoria: 'Privato',
      importo,
      note: nota,
      created_at: new Date().toISOString(),
    };
    if (cameraId) entry.camera_id = cameraId;

    entrate.push(entry);
    trovate++;
  }
  console.log(`[${sheetName}] ${trovate} righe Ricavo Privato`);
}

// Carica entrate esistenti
const dataDir = path.join(__dirname, '../data');
const entFile = path.join(dataDir, 'entrate.json');
const entExist = JSON.parse(fs.readFileSync(entFile, 'utf-8'));

// Deduplicazione per data + descrizione + importo
const chiavi = new Set(entExist.map(e => `${e.data}|${e.descrizione}|${e.importo}`));
const nuove = entrate.filter(e => !chiavi.has(`${e.data}|${e.descrizione}|${e.importo}`));
const saltate = entrate.length - nuove.length;

fs.writeFileSync(entFile, JSON.stringify([...entExist, ...nuove], null, 2));

console.log('');
console.log(`✓ Trovate ${entrate.length} righe "Ricavo Privato"`);
console.log(`✓ Importate ${nuove.length} entrate nuove${saltate ? ` (${saltate} già presenti, saltate)` : ''}`);
console.log('');

// Dettaglio per mese
const perMese = {};
nuove.forEach(e => {
  const m = e.data.slice(0, 7);
  if (!perMese[m]) perMese[m] = { n: 0, tot: 0 };
  perMese[m].n++;
  perMese[m].tot += e.importo;
});
Object.entries(perMese).sort(([a], [b]) => a.localeCompare(b)).forEach(([m, v]) => {
  console.log(`  ${m}: ${v.n} entrate, €${v.tot.toFixed(2)}`);
});
