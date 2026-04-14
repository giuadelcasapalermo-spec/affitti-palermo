import { NextRequest, NextResponse } from 'next/server';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prenotazioni = leggiPrenotazioni();
  const p = prenotazioni.find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  return NextResponse.json(p);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const prenotazioni = leggiPrenotazioni();
  const idx = prenotazioni.findIndex((x) => x.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  prenotazioni[idx] = { ...prenotazioni[idx], ...body };
  await scriviPrenotazioni(prenotazioni);
  return NextResponse.json(prenotazioni[idx]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prenotazioni = leggiPrenotazioni();
  const nuove = prenotazioni.filter((x) => x.id !== id);
  if (nuove.length === prenotazioni.length)
    return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  await scriviPrenotazioni(nuove);
  return NextResponse.json({ ok: true });
}
