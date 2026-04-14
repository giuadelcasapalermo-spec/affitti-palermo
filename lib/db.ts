import fs from 'fs';
import path from 'path';
import { Prenotazione } from './types';

const DB_PATH = path.join(process.cwd(), 'data', 'prenotazioni.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
  }
}

export function leggiPrenotazioni(): Prenotazione[] {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

export function scriviPrenotazioni(prenotazioni: Prenotazione[]) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(prenotazioni, null, 2));
}
