import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SECRET = process.env.AUTH_SECRET || 'giuadel-fallback-secret';
const UTENTI_FILE = path.join(process.cwd(), 'data', 'utenti.json');

export interface Utente {
  id: string;
  username: string;
  salt: string;
  hash: string;
}

export function leggiUtenti(): Utente[] {
  return JSON.parse(fs.readFileSync(UTENTI_FILE, 'utf-8'));
}

export function salvaUtenti(utenti: Utente[]) {
  fs.writeFileSync(UTENTI_FILE, JSON.stringify(utenti, null, 2));
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
