import { NextRequest, NextResponse } from 'next/server';
import { leggiUscite, scriviUscite } from '@/lib/uscite';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const uscite = leggiUscite();
  const idx = uscite.findIndex((u) => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  uscite[idx] = { ...uscite[idx], ...body, importo: Number(body.importo ?? uscite[idx].importo) };
  await scriviUscite(uscite);
  return NextResponse.json(uscite[idx]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uscite = leggiUscite();
  const nuove = uscite.filter((u) => u.id !== id);
  if (nuove.length === uscite.length) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  await scriviUscite(nuove);
  return NextResponse.json({ ok: true });
}
