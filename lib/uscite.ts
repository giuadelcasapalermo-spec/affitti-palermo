import fs from 'fs';
import path from 'path';
import { Uscita } from './types';

const PATH = path.join(process.cwd(), 'data', 'uscite.json');

export function leggiUscite(): Uscita[] {
  if (!fs.existsSync(PATH)) {
    fs.writeFileSync(PATH, '[]');
  }
  return JSON.parse(fs.readFileSync(PATH, 'utf-8'));
}

export function scriviUscite(uscite: Uscita[]) {
  fs.writeFileSync(PATH, JSON.stringify(uscite, null, 2));
}
