import { NextRequest, NextResponse } from 'next/server';
import { leggiEntrate, scriviEntrate } from '@/lib/entrate';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const entrate = leggiEntrate();
  const idx = entrate.findIndex((e) => e.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  entrate[idx] = { ...entrate[idx], ...body, importo: Number(body.importo ?? entrate[idx].importo) };
  scriviEntrate(entrate);
  return NextResponse.json(entrate[idx]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entrate = leggiEntrate();
  const nuove = entrate.filter((e) => e.id !== id);
  if (nuove.length === entrate.length) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  scriviEntrate(nuove);
  return NextResponse.json({ ok: true });
}
