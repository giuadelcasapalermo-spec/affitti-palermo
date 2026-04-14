import { NextResponse } from 'next/server';
import { CAMERE } from '@/lib/types';
import { leggiImpostazioni } from '@/lib/ical';

export async function GET() {
  const imp = leggiImpostazioni();
  const nomi = imp.nomi_camere ?? {};

  const camere = CAMERE.map((c) => ({
    ...c,
    nome: nomi[c.id] ?? c.nome,
  }));

  return NextResponse.json(camere);
}
