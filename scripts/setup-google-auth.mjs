/**
 * Esegui: node scripts/setup-google-auth.mjs CLIENT_ID CLIENT_SECRET
 *
 * Lo script:
 *  1. Apre il browser per autorizzare Google Sheets
 *  2. Cattura il codice di ritorno su localhost:4242
 *  3. Scambia il codice con i token
 *  4. Salva CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN in .env.local
 *  5. Stampa i valori da incollare su Vercel
 */

import http from 'http';
import { exec } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const [, , CLIENT_ID, CLIENT_SECRET] = process.argv;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nUso: node scripts/setup-google-auth.mjs CLIENT_ID CLIENT_SECRET\n');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:4242/callback';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n🔑 Apertura browser per autorizzazione Google Sheets...\n');
console.log('Se il browser non si apre, vai su:\n' + authUrl + '\n');

// Apri browser (Windows)
exec(`start "" "${authUrl}"`);

// Server locale per catturare il redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4242');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end('<h2>Errore: ' + error + '</h2><p>Chiudi questa finestra.</p>');
    console.error('\n❌ Errore OAuth:', error);
    server.close();
    return;
  }

  if (!code) {
    res.end('<p>Attesa codice...</p>');
    return;
  }

  res.end('<h2>✅ Autorizzazione completata!</h2><p>Puoi chiudere questa finestra e tornare al terminale.</p>');
  server.close();

  // Scambia codice con token
  console.log('✅ Codice ricevuto. Scambio con refresh token...\n');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    console.error('❌ Nessun refresh_token ricevuto. Risposta:', JSON.stringify(tokens, null, 2));
    console.log('\nSe hai già autorizzato questa app in precedenza, vai su:');
    console.log('https://myaccount.google.com/permissions');
    console.log('Revoca l\'accesso all\'app e riesegui lo script.\n');
    return;
  }

  // Salva in .env.local
  const envPath = resolve(process.cwd(), '.env.local');
  let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

  // Rimuovi eventuali righe esistenti
  envContent = envContent
    .split('\n')
    .filter(l => !l.startsWith('GOOGLE_CLIENT_ID=') && !l.startsWith('GOOGLE_CLIENT_SECRET=') && !l.startsWith('GOOGLE_REFRESH_TOKEN='))
    .join('\n')
    .trim();

  envContent += `\nGOOGLE_CLIENT_ID=${CLIENT_ID}\nGOOGLE_CLIENT_SECRET=${CLIENT_SECRET}\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
  writeFileSync(envPath, envContent);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ Salvato in .env.local\n');
  console.log('Aggiungi queste 3 variabili su Vercel (Settings → Environment Variables):\n');
  console.log(`  GOOGLE_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`  GOOGLE_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`  GOOGLE_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

server.listen(4242, () => {
  console.log('In attesa di autorizzazione su http://localhost:4242/callback ...\n');
});
