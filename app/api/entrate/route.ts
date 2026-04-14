import { NextRequest, NextResponse } from 'next/server';
import { leggiEntrate, scriviEntrate } from '@/lib/entrate';
import { Entrata } from '@/lib/types';
import { randomUUID } from 'crypto';

export async function GET() {
  return NextResponse.json(leggiEntrate());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const entrate = leggiEntrate();

  const nuova: Entrata = {
    id: randomUUID(),
    data: body.data,
    descrizione: body.descrizione,
    categoria: body.categoria,
    importo: Number(body.importo),
    camera_id: body.camera_id ?? undefined,
    note: body.note ?? '',
    created_at: new Date().toISOString(),
  };

  entrate.push(nuova);
  scriviEntrate(entrate);
  return NextResponse.json(nuova, { status: 201 });
}
