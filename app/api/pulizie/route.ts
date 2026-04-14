import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { Prenotazione } from '@/lib/types';

const GIORNI = ['Domenica', 'Lunedi', 'Martedi', 'Mercoledi', 'Giovedi', 'Venerdi', 'Sabato'];

function isoToSerial(iso: string): number {
  // Excel serial: days since 1899-12-30
  return Math.round(new Date(iso).getTime() / 86400000) + 25569;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dal = searchParams.get('dal') || '';
  const al  = searchParams.get('al')  || '';

  const dataDir = path.join(process.cwd(), 'data');

  const prenotazioni: Prenotazione[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'prenotazioni.json'), 'utf-8')
  );

  const impostazioni = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'impostazioni.json'), 'utf-8')
  );
  const nomiCamere: Record<number, string> = impostazioni.nomi_camere ?? {
    1: 'Bianca', 2: 'Gialla', 3: 'Rossa', 4: 'Verde', 5: 'Blue',
  };

  // Prendi solo prenotazioni confermate con check-out nel periodo
  const filtrate = prenotazioni
    .filter(p =>
      p.stato === 'confermata' &&
      (!dal || p.check_out >= dal) &&
      (!al  || p.check_out <= al)
    )
    .sort((a, b) => {
      const d = a.check_out.localeCompare(b.check_out);
      return d !== 0 ? d : a.camera_id - b.camera_id;
    });

  // Raggruppa per check-out date
  const gruppi = new Map<string, Prenotazione[]>();
  for (const p of filtrate) {
    if (!gruppi.has(p.check_out)) gruppi.set(p.check_out, []);
    gruppi.get(p.check_out)!.push(p);
  }

  // Costruisci righe
  type Row = (string | number)[];
  const rows: Row[] = [
    ['In carico a ', 'Giorno', 'Check in', 'Check out', 'Stanza', 'N.stanza', 'Cospite'],
  ];

  for (const [checkOut, pren] of gruppi) {
    const dow = new Date(checkOut).getDay(); // 0=Dom, 6=Sab
    const persona = (dow === 0 || dow === 6) ? 'Adriana' : 'Anna';
    const giorno  = GIORNI[dow];

    pren.forEach((p, i) => {
      rows.push([
        i === 0 ? persona : '',
        i === 0 ? giorno  : '',
        isoToSerial(p.check_in),
        isoToSerial(p.check_out),
        nomiCamere[p.camera_id] ?? `Camera ${p.camera_id}`,
        p.camera_id,
        p.ospite_nome,
      ]);
    });
  }

  // Crea workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Formato data per colonne Check in / Check out (C e D)
  for (let r = 1; r < rows.length; r++) {
    const ci = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    const co = ws[XLSX.utils.encode_cell({ r, c: 3 })];
    if (ci) { ci.t = 'n'; ci.z = 'DD/MM/YYYY'; }
    if (co) { co.t = 'n'; co.z = 'DD/MM/YYYY'; }
  }

  // Larghezze colonne
  ws['!cols'] = [
    { wch: 13 }, // In carico a
    { wch: 11 }, // Giorno
    { wch: 12 }, // Check in
    { wch: 12 }, // Check out
    { wch: 10 }, // Stanza
    { wch: 9  }, // N.stanza
    { wch: 40 }, // Cospite
  ];

  // Intestazione in grassetto
  ['A1','B1','C1','D1','E1','F1','G1'].forEach(addr => {
    if (ws[addr]) ws[addr].s = { font: { bold: true } };
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Pulizie');

  const fmt = (iso: string) => iso.split('-').reverse().join('-'); // yyyy-mm-dd → dd-mm-yyyy
  const periodo = dal && al ? `${fmt(dal)} ${fmt(al)}` : dal ? `dal ${fmt(dal)}` : 'periodo';
  const fileName = `Pulizie ${periodo}.xlsx`;

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
