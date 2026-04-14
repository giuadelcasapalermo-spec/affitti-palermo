const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const wb = XLSX.readFile('C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx');

function excelToISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 10000) return null;
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
}

// Tutti i fogli 2026 (formato nuovo con colonna Tassa)
const MESE_MAP = {
  Gennaio:   { anno: 2026, mese: 1  },
  Febbraio:  { anno: 2026, mese: 2  },
  Marzo:     { anno: 2026, mese: 3  },
  Aprile:    { anno: 2026, mese: 4  },
  Maggio:    { anno: 2026, mese: 5  },
  Giugno:    { anno: 2026, mese: 6  },
  Luglio:    { anno: 2026, mese: 7  },
  Agosto:    { anno: 2026, mese: 8  },
  Settembre: { anno: 2026, mese: 9  },
  Ottobre:   { anno: 2026, mese: 10 },
  Novembre:  { anno: 2026, mese: 11 },
  Dicembre:  { anno: 2026, mese: 12 },
};

function normalizeStanza(sta) {
  return sta.toLowerCase().trim()
    .replace(/l{3,}/g, 'll')   // Giallla → gialla
    .replace(/\s+/g, '');
}

const STANZA_ID = { bianca: 1, gialla: 2, rossa: 3, verde: 4, blue: 5, blu: 5 };

function getCols(headerRow) {
  // Formato 2026: Tipologia,Descrizione,Utile netto,Entrate,Uscite,Tassa,...,Data inizio,Data fine,...,Stanza,...
  return { tip: 0, des: 1, ent: 3, usc: 4, tax: 5, di: 10, df: 11, sta: 13, not: 15 };
}

const TIPI_RICAVO = new Set(['Ricavo Booking', 'Ricavo Privato', 'Ricavo AirBnb', 'Privato']);

const tasseDaCollegare = [];
const usciteNuove = [];

for (const sheetName of wb.SheetNames) {
  const info = MESE_MAP[sheetName];
  if (!info) continue;

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hi = rows.findIndex(r => String(r[0]).trim() === 'Tipologia');
  if (hi < 0) continue;

  const C = getCols(rows[hi]);
  const fallback = `${info.anno}-${String(info.mese).padStart(2, '0')}-15`;

  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const tip = String(row[C.tip] || '').trim();

    // --- Righe ricavo: collegare tassa_soggiorno alle prenotazioni ---
    if (TIPI_RICAVO.has(tip)) {
      const tax = Number(row[C.tax]) || 0;
      if (tax === 0) continue;

      const ent    = Number(row[C.ent]) || 0;
      const sta    = normalizeStanza(String(row[C.sta] || ''));
      const cameraId = STANZA_ID[sta] ?? null;
      const di     = excelToISO(row[C.di]) || fallback;
      const des    = String(row[C.des] || '').trim();

      tasseDaCollegare.push({ cameraId, check_in: di, importo: ent, tassa: tax, des, sheet: sheetName });
    }

    // --- Righe Tasse: cedolare secca → uscita ---
    if (tip === 'Tasse') {
      const usc = Number(row[C.usc]) || 0;
      if (usc === 0) continue;

      const des = String(row[C.des] || '').trim() || 'Cedolare secca booking';
      const di  = excelToISO(row[C.di]) || fallback;

      usciteNuove.push({
        id: randomUUID(),
        data: di,
        descrizione: des,
        categoria: 'Tasse',
        importo: usc,
        note: sheetName,
        created_at: new Date().toISOString(),
      });
    }
  }
}

// --- Carica dati esistenti ---
const dataDir = path.join(__dirname, '../data');
const prenFile = path.join(dataDir, 'prenotazioni.json');
const uscFile  = path.join(dataDir, 'uscite.json');

const prenotazioni = JSON.parse(fs.readFileSync(prenFile, 'utf-8'));
const usciteExist  = JSON.parse(fs.readFileSync(uscFile,  'utf-8'));

// --- Collega tassa_soggiorno alle prenotazioni ---
let aggiornate = 0;
let nonTrovate = [];

for (const t of tasseDaCollegare) {
  if (!t.cameraId) {
    nonTrovate.push(`[STANZA?] ${t.sheet} "${t.des}" camera non riconosciuta`);
    continue;
  }

  // Match esatto: camera + check_in + importo (tolleranza 0.02 per arrotondamenti)
  let match = prenotazioni.find(p =>
    p.camera_id === t.cameraId &&
    p.check_in  === t.check_in &&
    Math.abs(p.importo_totale - t.importo) < 0.02
  );

  // Match rilassato: camera + check_in (se una sola prenotazione quel giorno)
  if (!match) {
    const candidati = prenotazioni.filter(p =>
      p.camera_id === t.cameraId && p.check_in === t.check_in
    );
    if (candidati.length === 1) match = candidati[0];
  }

  if (match) {
    match.tassa_soggiorno = t.tassa;
    aggiornate++;
  } else {
    nonTrovate.push(`[NOTFOUND] ${t.sheet} cam${t.cameraId} ${t.check_in} €${t.importo} tds=${t.tassa} "${t.des}"`);
  }
}

// --- Salva uscite (dedup per data+descrizione+importo) ---
const chiavi = new Set(usciteExist.map(u => `${u.data}|${u.descrizione}|${u.importo}`));
const usciteFiltered = usciteNuove.filter(u => !chiavi.has(`${u.data}|${u.descrizione}|${u.importo}`));

fs.writeFileSync(prenFile, JSON.stringify(prenotazioni, null, 2));
fs.writeFileSync(uscFile,  JSON.stringify([...usciteExist, ...usciteFiltered], null, 2));

// --- Report ---
console.log(`✓ Prenotazioni aggiornate con tassa di soggiorno: ${aggiornate}`);
console.log(`✓ Uscite cedolare secca importate: ${usciteFiltered.length}`);

if (nonTrovate.length) {
  console.log(`\n⚠ Non trovate (${nonTrovate.length}):`);
  nonTrovate.forEach(r => console.log(' ', r));
}

// Riepilogo per mese
const perMese = {};
prenotazioni.filter(p => p.tassa_soggiorno).forEach(p => {
  const m = p.check_in.slice(0, 7);
  if (!perMese[m]) perMese[m] = { n: 0, tot: 0 };
  perMese[m].n++;
  perMese[m].tot += p.tassa_soggiorno;
});
console.log('\nRiepilogo tasse di soggiorno per mese:');
Object.entries(perMese).sort(([a],[b]) => a.localeCompare(b)).forEach(([m, v]) => {
  console.log(`  ${m}: ${v.n} prenotazioni, €${v.tot.toFixed(2)} TdS totale`);
});
