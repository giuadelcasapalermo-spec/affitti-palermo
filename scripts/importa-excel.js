const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const wb = XLSX.readFile('C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx');

// Converti serial Excel → 'yyyy-MM-dd'
function excelToISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 10000) return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split('T')[0];
}

// Mappa sheet → anno/mese (fallback date per righe senza data)
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

// Stanza → camera_id
const STANZA_ID = {
  Bianca: 1, bianca: 1,
  Gialla: 2, gialla: 2,
  Rossa:  3, rossa:  3,
  Verde:  4, verde:  4,
  Blue:   5, blue:   5, Blu: 5,
};

// Tipologia uscita → categoria app
const CAT_MAP = {
  Arredamento:      'Arredamento',
  Utenze:           'Utenze',
  'Acquisti varie': 'Forniture',
  'Spese varie':    'Forniture',
  Pubblicità:       'Pubblicità',
  Affitto:          'Affitto',
};

const TIPI_ENTRATA = new Set([
  'Ricavo Booking', 'Ricavo Privato', 'Ricavo AirBnb', 'Privato',
]);
const TIPI_USCITA = new Set(Object.keys(CAT_MAP));

// Rileva layout colonne in base all'intestazione
function getCols(headerRow) {
  // Formato vecchio (Ott-Dic 2025): Tipologia,Descrizione,Differenza,Entrate,Uscite,Ferrotti,DataInizio,DataFine,Fornitore,Stanza,Quantita,Note
  // Formato nuovo (Gen-Dic 2026): Tipologia,Descrizione,Diff,Entrate,Uscite,Tassa,Booking,%Booking,Ferrotti,%Ferrotti,DataInizio,DataFine,Fornitore,Stanza,Quantità,Note
  const isOld = (headerRow.length <= 12) || (String(headerRow[5] || '').toLowerCase().includes('ferrott'));
  if (isOld) {
    return { tip:0, des:1, ent:3, usc:4, di:6, df:7, for:8, sta:9, not:11 };
  }
  return { tip:0, des:1, ent:3, usc:4, di:10, df:11, for:12, sta:13, not:15 };
}

const prenotazioni = [];
const uscite = [];

for (const sheetName of wb.SheetNames) {
  const info = MESE_MAP[sheetName];
  if (!info) { console.log('Skip sheet:', sheetName); continue; }

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Trova intestazione principale (prima riga con "Tipologia")
  const headerIdx = rows.findIndex(r => String(r[0]).trim() === 'Tipologia');
  if (headerIdx < 0) continue;
  const C = getCols(rows[headerIdx]);

  const fallback = `${info.anno}-${String(info.mese).padStart(2,'0')}-01`;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const tip = String(row[C.tip] || '').trim();
    if (!tip || tip === 'Tipologia') continue; // salta header o totali

    const ent = Number(row[C.ent]) || 0;
    const usc = Number(row[C.usc]) || 0;
    if (ent === 0 && usc === 0) continue;

    const des   = String(row[C.des] || '').trim();
    const sta   = String(row[C.sta] || '').trim();
    const nota  = String(row[C.not] || '').trim();
    const forni = String(row[C.for] || '').trim();
    const di    = excelToISO(row[C.di]) || fallback;
    const df    = excelToISO(row[C.df]) || di;

    // --- ENTRATA → prenotazione ---
    if (TIPI_ENTRATA.has(tip) && ent > 0) {
      prenotazioni.push({
        id: randomUUID(),
        camera_id: STANZA_ID[sta] ?? null,
        ospite_nome: des || 'Ospite',
        ospite_telefono: '',
        ospite_email: '',
        check_in: di,
        check_out: df,
        importo_totale: ent,
        stato: 'confermata',
        note: [tip, nota].filter(Boolean).join(' — '),
        created_at: new Date().toISOString(),
        fonte: 'manuale',
      });
      continue;
    }

    // --- USCITA ---
    if (TIPI_USCITA.has(tip) && usc > 0) {
      uscite.push({
        id: randomUUID(),
        data: di,
        descrizione: des || tip,
        categoria: CAT_MAP[tip] || 'Altro',
        importo: usc,
        note: [forni, nota].filter(Boolean).join(' — '),
        created_at: new Date().toISOString(),
      });
    }
  }
}

// Salva
const dataDir = path.join(__dirname, '../data');
const prenFile = path.join(dataDir, 'prenotazioni.json');
const uscFile  = path.join(dataDir, 'uscite.json');

const prenExist = JSON.parse(fs.readFileSync(prenFile, 'utf-8'));
const uscExist  = JSON.parse(fs.readFileSync(uscFile,  'utf-8'));

// Rinomina camere in impostazioni
const impFile = path.join(dataDir, 'impostazioni.json');
const imp = JSON.parse(fs.readFileSync(impFile, 'utf-8'));
imp.nomi_camere = { 1:'Bianca', 2:'Gialla', 3:'Rossa', 4:'Verde', 5:'Blue' };
fs.writeFileSync(impFile, JSON.stringify(imp, null, 2));

fs.writeFileSync(prenFile, JSON.stringify([...prenExist, ...prenotazioni], null, 2));
fs.writeFileSync(uscFile,  JSON.stringify([...uscExist,  ...uscite],  null, 2));

console.log(`✓ Importate ${prenotazioni.length} prenotazioni, ${uscite.length} uscite`);
console.log(`  Camere rinominate: Bianca/Gialla/Rossa/Verde/Blue`);

// Dettaglio per mese
const perMese = {};
prenotazioni.forEach(p => {
  const m = p.check_in.slice(0,7);
  if (!perMese[m]) perMese[m] = { pren:0, entrate:0 };
  perMese[m].pren++;
  perMese[m].entrate += p.importo_totale;
});
Object.entries(perMese).sort(([a],[b]) => a.localeCompare(b)).forEach(([m, v]) => {
  console.log(`  ${m}: ${v.pren} prenotazioni, €${v.entrate.toFixed(2)} entrate`);
});
const perMeseU = {};
uscite.forEach(u => {
  const m = u.data.slice(0,7);
  if (!perMeseU[m]) perMeseU[m] = 0;
  perMeseU[m] += u.importo;
});
Object.entries(perMeseU).sort(([a],[b]) => a.localeCompare(b)).forEach(([m, tot]) => {
  console.log(`  ${m}: uscite €${tot.toFixed(2)}`);
});
