import { NextRequest, NextResponse } from 'next/server';
import { leggiUtenti, salvaUtenti, hashPassword, nuovoSalt } from '@/lib/auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { password } = await request.json();

  const utenti = await leggiUtenti();
  const u = utenti.find((u) => u.id === id);
  if (!u) return NextResponse.json({ error: 'Non trovato' }, { status: 404 });

  u.salt = nuovoSalt();
  u.hash = hashPassword(password, u.salt);
  await salvaUtenti(utenti);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const utenti = await leggiUtenti();
  if (utenti.length <= 1) {
    return NextResponse.json({ error: 'Deve esserci almeno un utente' }, { status: 400 });
  }
  await salvaUtenti(utenti.filter((u) => u.id !== id));
  return NextResponse.json({ ok: true });
}
