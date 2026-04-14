/**
 * Su Vercel (filesystem read-only), le scritture vengono redirezionate
 * sull'API GitHub che aggiorna i file JSON nel repository.
 * Vercel rileva il commit e rideploya automaticamente (~1 min).
 *
 * In locale (npm run dev) si continua a usare fs.writeFileSync normale.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO ?? 'giuadelcasapalermo-spec/affitti-palermo';
const GITHUB_BRANCH = 'main';

const BASE = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

/** true quando giriamo dentro Vercel */
export const onVercel = process.env.VERCEL === '1';

async function githubGet(filePath: string) {
  const res = await fetch(`${BASE}/${filePath}?ref=${GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) {
    const err = await res.json() as { message?: string };
    throw new Error(`GitHub GET ${filePath}: ${err.message ?? res.status}`);
  }
  return res.json() as Promise<{ sha: string; content: string }>;
}

/**
 * Aggiorna (o crea) un file nel repo GitHub.
 * content: stringa UTF-8 del nuovo contenuto.
 */
export async function githubWrite(filePath: string, content: string, message?: string): Promise<void> {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN non configurato');

  // Recupera SHA corrente (necessario per PUT)
  let sha: string | undefined;
  try {
    const current = await githubGet(filePath);
    sha = current.sha;
  } catch {
    // File non esiste ancora → creazione (sha non serve)
  }

  const body: Record<string, unknown> = {
    message: message ?? `Aggiornamento ${filePath} da app`,
    content: Buffer.from(content).toString('base64'),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${BASE}/${filePath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json() as { message?: string };
    throw new Error(`GitHub PUT ${filePath}: ${err.message ?? res.status}`);
  }
}
