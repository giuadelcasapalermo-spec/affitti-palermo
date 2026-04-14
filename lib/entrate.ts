import fs from 'fs';
import path from 'path';
import { Entrata } from './types';
import { onVercel, githubRead, githubWrite } from './github-storage';

const PATH = path.join(process.cwd(), 'data', 'entrate.json');
const GITHUB_PATH = 'data/entrate.json';

export async function leggiEntrate(): Promise<Entrata[]> {
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

export async function scriviEntrate(entrate: Entrata[]): Promise<void> {
  const json = JSON.stringify(entrate, null, 2);
  if (onVercel) {
    await githubWrite(GITHUB_PATH, json);
  } else {
    fs.writeFileSync(PATH, json);
  }
}
