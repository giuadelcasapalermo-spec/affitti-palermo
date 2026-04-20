import { NextRequest, NextResponse } from 'next/server';
import { leggiUtenti, verificaPassword, creaToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  const utenti = await leggiUtenti();
  const utente = utenti.find((u) => u.username === username);

  if (!utente || !verificaPassword(password, utente.hash, utente.salt)) {
    return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
  }

  const token = creaToken(utente.username);

  const res = NextResponse.json({ ok: true, username: utente.username });
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
  return res;
}
