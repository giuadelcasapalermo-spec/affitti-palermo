import fs from 'fs';
import path from 'path';
import { Entrata } from './types';

const PATH = path.join(process.cwd(), 'data', 'entrate.json');

export function leggiEntrate(): Entrata[] {
  if (!fs.existsSync(PATH)) fs.writeFileSync(PATH, '[]');
  return JSON.parse(fs.readFileSync(PATH, 'utf-8'));
}

export function scriviEntrate(entrate: Entrata[]) {
  fs.writeFileSync(PATH, JSON.stringify(entrate, null, 2));
}
