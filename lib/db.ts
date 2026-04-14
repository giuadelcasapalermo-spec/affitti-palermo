import fs from 'fs';
import path from 'path';
import { Prenotazione } from './types';

const DB_PATH = path.join(process.cwd(), 'data', 'prenotazioni.json');

export function leggiPrenotazioni(): Prenotazione[] {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

export function scriviPrenotazioni(prenotazioni: Prenotazione[]) {
  fs.writeFileSync(DB_PATH, JSON.stringify(prenotazioni, null, 2));
}
