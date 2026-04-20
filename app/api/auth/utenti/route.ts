import { NextRequest, NextResponse } from 'next/server';
import { leggiUtenti, salvaUtenti, hashPassword, nuovoSalt } from '@/lib/auth';
import { randomUUID } from 'crypto';

export async function GET() {
  const utenti = (await leggiUtenti()).map(({ id, username }) => ({ id, username }));
  return NextResponse.json(utenti);
}

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'Username e password richiesti' }, { status: 400 });
  }

  const utenti = await leggiUtenti();
  if (utenti.find((u) => u.username === username)) {
    return NextResponse.json({ error: 'Username già esistente' }, { status: 409 });
  }

  const salt = nuovoSalt();
  const hash = hashPassword(password, salt);
  utenti.push({ id: randomUUID(), username, salt, hash });
  await salvaUtenti(utenti);

  return NextResponse.json({ ok: true });
}
