import fs from 'fs';
import path from 'path';
import { Uscita } from './types';
import { onVercel, githubWrite } from './github-storage';

const PATH = path.join(process.cwd(), 'data', 'uscite.json');
const GITHUB_PATH = 'data/uscite.json';

export function leggiUscite(): Uscita[] {
  if (!fs.existsSync(PATH)) return [];
  return JSON.parse(fs.readFileSync(PATH, 'utf-8'));
}

export async function scriviUscite(uscite: Uscita[]): Promise<void> {
  const json = JSON.stringify(uscite, null, 2);
  if (onVercel) {
    await githubWrite(GITHUB_PATH, json);
  } else {
    fs.writeFileSync(PATH, json);
  }
}
