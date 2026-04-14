import { NextRequest, NextResponse } from 'next/server';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import { Prenotazione } from '@/lib/types';
import { randomUUID } from 'crypto';

export async function GET() {
  const prenotazioni = leggiPrenotazioni();
  return NextResponse.json(prenotazioni);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const prenotazioni = leggiPrenotazioni();

  const nuova: Prenotazione = {
    id: randomUUID(),
    camera_id: body.camera_id,
    ospite_nome: body.ospite_nome,
    ospite_telefono: body.ospite_telefono ?? '',
    ospite_email: body.ospite_email ?? '',
    check_in: body.check_in,
    check_out: body.check_out,
    importo_totale: body.importo_totale,
    tassa_soggiorno: body.tassa_soggiorno ? Number(body.tassa_soggiorno) : undefined,
    stato: body.stato ?? 'confermata',
    note: body.note ?? '',
    created_at: new Date().toISOString(),
    fonte: 'manuale',
  };

  prenotazioni.push(nuova);
  scriviPrenotazioni(prenotazioni);
  return NextResponse.json(nuova, { status: 201 });
}
