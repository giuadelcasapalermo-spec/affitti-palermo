/**
 * Genera un nuovo refresh token Google con scope Sheets + Gmail.
 * Esegui con: npx tsx scripts/get-gmail-token.ts
 *
 * Prerequisito: Gmail API abilitata su Google Cloud Console.
 */

import { google } from 'googleapis';
import http from 'http';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI  = 'http://localhost:8080/callback';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n1. Apri questo URL nel browser:\n');
console.log(authUrl);
console.log('\n2. Autorizza e aspetta...\n');

// Server locale che cattura il callback
const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) return;

  const code = new URL(req.url, 'http://localhost:8080').searchParams.get('code');
  if (!code) {
    res.end('Errore: nessun codice ricevuto.');
    return;
  }

  res.end('<h2>Autorizzato! Torna al terminale.</h2>');
  server.close();

  const { tokens } = await oauth2.getToken(code);

  console.log('\n✓ Token ottenuto!\n');
  console.log('Aggiorna .env.local e Vercel con questo valore:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
});

server.listen(8080);
