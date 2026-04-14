import fs from 'fs';
import path from 'path';
import { Uscita } from './types';
import { onVercel, githubRead, githubWrite } from './github-storage';

const PATH = path.join(process.cwd(), 'data', 'uscite.json');
const GITHUB_PATH = 'data/uscite.json';

export async function leggiUscite(): Promise<Uscita[]> {
  if (onVercel) {
    try {
      const raw = await githubRead(GITHUB_PATH);
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
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
