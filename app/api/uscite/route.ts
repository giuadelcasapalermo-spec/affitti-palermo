import { NextRequest, NextResponse } from 'next/server';
import { leggiUscite, scriviUscite } from '@/lib/uscite';
import { Uscita } from '@/lib/types';
import { randomUUID } from 'crypto';

export async function GET() {
  return NextResponse.json(leggiUscite());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const uscite = leggiUscite();

  const nuova: Uscita = {
    id: randomUUID(),
    data: body.data,
    descrizione: body.descrizione,
    categoria: body.categoria,
    importo: Number(body.importo),
    camera_id: body.camera_id ?? undefined,
    note: body.note ?? '',
    created_at: new Date().toISOString(),
  };

  uscite.push(nuova);
  await scriviUscite(uscite);
  return NextResponse.json(nuova, { status: 201 });
}
