import { NextResponse } from 'next/server';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import * as XLSX from 'xlsx';

export const maxDuration = 30;

const STANZA_ID: Record<string, number> = {
  bianca: 1, 'camera 1': 1, '1': 1,
  gialla: 2, 'camera 2': 2, '2': 2,
  rossa:  3, 'camera 3': 3, '3': 3,
  verde:  4, 'camera 4': 4, '4': 4,
  blue:   5, blu: 5, 'camera 5': 5, '5': 5,
};

function excelToISO(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number' && val > 10000) {
    return new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
  }
  const m = String(val).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function getCols(headerRow: unknown[]): Record<string, number> {
  const isOld = headerRow.length <= 12 || String(headerRow[5] ?? '').toLowerCase().includes('ferrott');
  if (isOld) return { tip: 0, des: 1, ent: 3, di: 6, df: 7, sta: 9 };
  return { tip: 0, des: 1, ent: 3, di: 10, df: 11, sta: 13 };
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, errore: 'FormData mancante' }, { status: 400 });

  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ ok: false, errore: 'File mancante' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: 'buffer' });

  // Raccogli righe Ricavo Booking dall'Excel
  type RigaExcel = { cameraId: number; checkIn: string; checkOut: string; nome: string; importo: number };
  const righe: RigaExcel[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    const headerIdx = rows.findIndex(r => String((r as unknown[])[0]).trim() === 'Tipologia');
    if (headerIdx < 0) continue;
    const C = getCols(rows[headerIdx] as unknown[]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const tipo = String(row[C.tip] ?? '').trim().toLowerCase();
      if (tipo !== 'ricavo booking') continue;

      const nome    = String(row[C.des] ?? '').trim();
      const importo = parseFloat(String(row[C.ent])) || 0;
      const checkIn = excelToISO(row[C.di]);
      const checkOut = excelToISO(row[C.df]);
      const stanza  = String(row[C.sta] ?? '').trim().toLowerCase();
      const cameraId = STANZA_ID[stanza];

      if (!checkIn || !cameraId || importo <= 0) continue;
      righe.push({ cameraId, checkIn, checkOut: checkOut ?? checkIn, nome, importo });
    }
  }

  if (righe.length === 0) {
    return NextResponse.json({ ok: false, errore: 'Nessuna riga "Ricavo Booking" trovata nel file' }, { status: 400 });
  }

  const prenotazioni = await leggiPrenotazioni();
  let aggiornate = 0;

  for (const riga of righe) {
    const match = prenotazioni.find(p =>
      p.camera_id === riga.cameraId &&
      p.check_in  === riga.checkIn &&
      p.check_out === riga.checkOut &&
      p.stato !== 'cancellata'
    );
    if (!match) continue;

    if (!match.ospite_nome || match.ospite_nome === 'Ospite Booking.com') {
      match.ospite_nome = riga.nome;
    }
    if (!match.importo_totale || match.importo_totale === 0) {
      match.importo_totale = riga.importo;
    }
    aggiornate++;
  }

  // Elimina record rimasti con "Ospite Booking.com"
  const prima = prenotazioni.length;
  const filtrate = prenotazioni.filter(p => p.ospite_nome !== 'Ospite Booking.com');
  const eliminate = prima - filtrate.length;

  await scriviPrenotazioni(filtrate);

  return NextResponse.json({ ok: true, aggiornate, eliminate, righeExcel: righe.length });
}
