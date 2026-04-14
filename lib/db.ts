import fs from 'fs';
import path from 'path';
import { Prenotazione } from './types';
import { onVercel, githubWrite } from './github-storage';

const DB_PATH = path.join(process.cwd(), 'data', 'prenotazioni.json');
const GITHUB_PATH = 'data/prenotazioni.json';

export function leggiPrenotazioni(): Prenotazione[] {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

export async function scriviPrenotazioni(prenotazioni: Prenotazione[]): Promise<void> {
  const json = JSON.stringify(prenotazioni, null, 2);
  if (onVercel) {
    await githubWrite(GITHUB_PATH, json);
  } else {
    fs.writeFileSync(DB_PATH, json);
  }
}
