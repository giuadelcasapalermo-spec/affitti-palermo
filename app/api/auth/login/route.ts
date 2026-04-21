import { NextRequest, NextResponse } from 'next/server';
import { leggiUtenti, salvaUtenti, verificaPassword, creaToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  const utenti = await leggiUtenti();
  const utente = utenti.find((u) => u.username === username);

  if (!utente) {
    return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
  }

  const risultato = verificaPassword(password, utente.hash, utente.salt);
  if (!risultato.valida) {
    return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
  }

  // Migrazione silenziosa: aggiorna l'hash da 10k a 600k iterazioni
  if (risultato.nuovoHash) {
    utente.hash = risultato.nuovoHash;
    await salvaUtenti(utenti);
  }

  const token = creaToken(utente.username);
  const res   = NextResponse.json({ ok: true, username: utente.username });
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
  return res;
}
