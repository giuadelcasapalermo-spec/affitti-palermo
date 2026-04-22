import XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = 'postgresql://neondb_owner:npg_tL1OT2eDnaHx@ep-dawn-water-amf209i5-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';
const sql = neon(DATABASE_URL);

function excelToISO(val) {
  if (!val || typeof val !== 'number' || val < 10000 || val > 100000) return null;
  return new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
}

// Mapping corretto: Rossa=1, Gialla=2, Verde=3, Bianca=4, Blue=5
const STANZA_ID = {
  'rossa': 1,
  'gialla': 2, 'giallla': 2,
  'verde': 3,
  'bianca': 4, 'bianca ': 4, 'bIanca': 4, 'bianca)': 4,
  'blue': 5, 'blu': 5,
};

function stanzaToId(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (STANZA_ID[s] !== undefined) return STANZA_ID[s];
  for (const [k, v] of Object.entries(STANZA_ID)) {
    if (s.includes(k)) return v;
  }
  return null;
}

// Leggi Excel
const wb = XLSX.readFile('C:/Users/Dario/Desktop/Prima nota GiuAdel 2025.xlsx');
const righe = [];

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headerIdx = rows.findIndex(r => String(r[0]).trim() === 'Tipologia');
  if (headerIdx < 0) continue;

  const ncols = rows[headerIdx].length;
  const is16 = ncols >= 16;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[0]).trim().toLowerCase() !== 'ricavo booking') continue;

    const nome     = String(row[1] ?? '').trim();
    const entrate  = parseFloat(row[3]) || 0;
    const bookingI = is16 ? (parseFloat(row[6]) || 0) : 0;
    const importo  = bookingI > 0 ? bookingI : entrate;

    const checkIn  = excelToISO(is16 ? row[10] : row[6]);
    const checkOut = excelToISO(is16 ? row[11] : row[7]);
    const stanza   = is16 ? row[13] : row[9];
    const cameraId = stanzaToId(stanza);

    if (!checkIn || !cameraId || importo <= 0) continue;

    righe.push({ nome, importo, checkIn, checkOut, cameraId, foglio: name });
  }
}

console.log(`\nRighe Excel trovate: ${righe.length}`);

// Leggi prenotazioni dal DB
const prenotazioni = await sql`
  SELECT id, camera_id, ospite_nome, check_in, check_out, importo_totale, stato
  FROM prenotazioni
  ORDER BY check_in
`;

console.log(`Prenotazioni in DB: ${prenotazioni.length}`);

let aggiornate = 0;
let nonTrovate = 0;

for (const riga of righe) {
  // Match per camera_id + check_in (tollerante: cerca anche check_in ±1 giorno)
  let match = prenotazioni.find(p =>
    p.camera_id === riga.cameraId &&
    p.check_in === riga.checkIn &&
    p.stato !== 'cancellata'
  );

  if (!match) {
    // Prova con data +1 giorno (a volte l'iCal ha offset)
    const d = new Date(riga.checkIn + 'T00:00:00Z');
    d.setDate(d.getDate() + 1);
    const checkIn1 = d.toISOString().split('T')[0];
    match = prenotazioni.find(p =>
      p.camera_id === riga.cameraId &&
      p.check_in === checkIn1 &&
      p.stato !== 'cancellata'
    );
  }

  if (!match) {
    console.log(`  ✗ Non trovata: ${riga.foglio} | ${riga.checkIn} | cam${riga.cameraId} | ${riga.nome}`);
    nonTrovate++;
    continue;
  }

  const nomeNuovo = (!match.ospite_nome || match.ospite_nome === 'Ospite Booking.com') ? riga.nome : match.ospite_nome;
  const importoNuovo = (!match.importo_totale || match.importo_totale === 0) ? riga.importo : match.importo_totale;

  const changed = nomeNuovo !== match.ospite_nome || importoNuovo !== Number(match.importo_totale);

  if (changed) {
    await sql`
      UPDATE prenotazioni
      SET ospite_nome = ${nomeNuovo}, importo_totale = ${importoNuovo}
      WHERE id = ${match.id}
    `;
    console.log(`  ✓ Aggiornata: ${match.check_in} | cam${match.camera_id} | ${match.ospite_nome} → ${nomeNuovo} | ${match.importo_totale} → ${importoNuovo}`);
    // Aggiorna cache locale
    match.ospite_nome = nomeNuovo;
    match.importo_totale = importoNuovo;
    aggiornate++;
  }
}

// Elimina "Ospite Booking.com" o senza importo
const { count: eliminateCount } = await sql`
  SELECT COUNT(*) as count FROM prenotazioni
  WHERE (ospite_nome = 'Ospite Booking.com' OR importo_totale IS NULL OR importo_totale = 0)
  AND stato != 'cancellata'
`.then(r => r[0]);

console.log(`\nRecord da eliminare (Ospite Booking.com o senza importo): ${eliminateCount}`);

const eliminate = await sql`
  DELETE FROM prenotazioni
  WHERE (ospite_nome = 'Ospite Booking.com' OR importo_totale IS NULL OR importo_totale = 0)
  AND stato != 'cancellata'
  RETURNING id, camera_id, check_in, ospite_nome, importo_totale
`;

console.log(`\n=== RIEPILOGO ===`);
console.log(`Righe Excel processate: ${righe.length}`);
console.log(`Prenotazioni aggiornate: ${aggiornate}`);
console.log(`Non trovate in DB:       ${nonTrovate}`);
console.log(`Eliminate:               ${eliminate.length}`);
if (eliminate.length > 0) {
  eliminate.forEach(e => console.log(`  - ${e.check_in} | cam${e.camera_id} | ${e.ospite_nome} | €${e.importo_totale}`));
}
