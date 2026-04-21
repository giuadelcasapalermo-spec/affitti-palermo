import crypto from 'crypto';
import sql from './postgres';

// PBKDF2-SHA256: 600k iterazioni (raccomandazione NIST SP 800-132 2023)
const ITERATIONS_CURRENT = 600_000;
const ITERATIONS_LEGACY  = 10_000; // usato prima del 2025-04 — mantenuto per migrazione

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET non configurato nelle variabili d\'ambiente');
  return s;
}

export interface Utente {
  id: string;
  username: string;
  salt: string;
  hash: string;
}

export async function leggiUtenti(): Promise<Utente[]> {
  const rows = await sql`SELECT id, username, salt, hash FROM utenti` as Utente[];
  return rows;
}

export async function salvaUtenti(utenti: Utente[]): Promise<void> {
  for (const u of utenti) {
    await sql`
      INSERT INTO utenti (id, username, salt, hash)
      VALUES (${u.id}, ${u.username}, ${u.salt}, ${u.hash})
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        salt = EXCLUDED.salt,
        hash = EXCLUDED.hash
    `;
  }
  const ids = utenti.map((u) => u.id);
  if (ids.length > 0) {
    await sql`DELETE FROM utenti WHERE id != ALL(${ids})`;
  }
}

export function hashPassword(password: string, salt: string, iterations = ITERATIONS_CURRENT): string {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
}

export function nuovoSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Verifica la password e segnala se l'hash va aggiornato (migrazione a 600k iterazioni).
 * Ritorna { valida: false } se la password è errata.
 * Ritorna { valida: true, nuovoHash } se era hashata con le vecchie iterazioni — il chiamante
 * deve salvare nuovoHash nel DB per completare la migrazione silenziosamente.
 */
export function verificaPassword(
  password: string,
  hash: string,
  salt: string,
): { valida: boolean; nuovoHash?: string } {
  const hashCorrente = hashPassword(password, salt, ITERATIONS_CURRENT);
  if (hashCorrente === hash) return { valida: true };

  const hashLegacy = hashPassword(password, salt, ITERATIONS_LEGACY);
  if (hashLegacy === hash) {
    return { valida: true, nuovoHash: hashCorrente };
  }

  return { valida: false };
}

export function creaToken(username: string): string {
  const secret  = getSecret();
  const payload = Buffer.from(
    JSON.stringify({ u: username, e: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verificaToken(token: string): { u: string; e: number } | null {
  try {
    const secret = getSecret();
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;

    const expected   = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const sigBuf     = Buffer.from(sig,      'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.e < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
