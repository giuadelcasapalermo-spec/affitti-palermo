import crypto from 'crypto';
import sql from './postgres';

const SECRET = process.env.AUTH_SECRET || 'giuadel-fallback-secret';

export interface Utente {
  id: string;
  username: string;
  salt: string;
  hash: string;
}

export async function leggiUtenti(): Promise<Utente[]> {
  const rows = await sql`SELECT id, username, salt, hash FROM utenti`;
  return rows as unknown as Utente[];
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

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
}

export function nuovoSalt(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function verificaPassword(password: string, hash: string, salt: string): boolean {
  return hashPassword(password, salt) === hash;
}

export function creaToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, e: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verificaToken(token: string): { u: string; e: number } | null {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    if (expected !== sig) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.e < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
