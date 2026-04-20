import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import sql from './postgres';

// ── Auth ───────────────────────────────────────────────────────────────────
function getAuth() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Credenziali Google non configurate');
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

// ── Mesi italiani ──────────────────────────────────────────────────────────
const MESI: Record<string, string> = {
  gennaio: '01', febbraio: '02', marzo: '03', aprile: '04',
  maggio: '05', giugno: '06', luglio: '07', agosto: '08',
  settembre: '09', ottobre: '10', novembre: '11', dicembre: '12',
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parseData(testo: string): string | null {
  // Formato: "15 aprile 2026" o "April 15, 2026" o "15/04/2026"
  const m1 = testo.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (m1) {
    const mese = MESI[m1[2].toLowerCase()];
    if (mese) return `${m1[3]}-${mese}-${m1[1].padStart(2, '0')}`;
  }
  const m2 = testo.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m2) {
    const mese = MESI[m2[1].toLowerCase()];
    if (mese) return `${m2[3]}-${mese}-${m2[2].padStart(2, '0')}`;
  }
  const m3 = testo.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DatiPrenotazioneEmail {
  booking_number: string;
  ospite_nome: string;
  check_in: string | null;
  check_out: string | null;
  camera_nome: string;
  importo: number;
  ospite_email: string;
  ospite_telefono: string;
  num_ospiti: number;
  gmail_message_id: string;
}

function parseEmailBooking(testo: string, messageId: string): DatiPrenotazioneEmail | null {
  // Numero prenotazione
  const numMatch = testo.match(/(?:numero\s+(?:di\s+)?prenotazione|booking\s+(?:number|id|no\.?)|reservation\s+(?:number|id))[\s:]*([0-9]{6,12})/i)
    ?? testo.match(/\b([0-9]{10})\b/);
  if (!numMatch) return null;
  const booking_number = numMatch[1];

  // Nome ospite
  const nomeMatch = testo.match(/(?:nome\s+(?:dell'ospite|ospite)|guest\s+name|ospite)[\s:]+([A-ZÀÁÂÃÄÅÆÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜ][a-zA-ZÀ-ÿ\s'-]{2,40}?)(?:\n|,|\s{2,}|\|)/i);
  const ospite_nome = nomeMatch ? nomeMatch[1].trim() : 'Ospite Booking.com';

  // Date
  let check_in: string | null = null;
  let check_out: string | null = null;

  const arrivoMatch = testo.match(/(?:arrivo|check.?in|arrival)[\s:]+([^\n]{5,30})/i);
  if (arrivoMatch) check_in = parseData(arrivoMatch[1]);

  const partenzaMatch = testo.match(/(?:partenza|check.?out|departure)[\s:]+([^\n]{5,30})/i);
  if (partenzaMatch) check_out = parseData(partenzaMatch[1]);

  // Camera
  const cameraMatch = testo.match(/(?:camera|room|stanza|unit[àa])[\s:]+([^\n]{3,50})/i);
  const camera_nome = cameraMatch ? cameraMatch[1].trim() : '';

  // Importo
  const importoMatch = testo.match(/(?:totale|total|importo|price|prezzo)[\s:€$£]*([0-9]+(?:[.,][0-9]{2})?)/i);
  const importo = importoMatch ? parseFloat(importoMatch[1].replace(',', '.')) : 0;

  // Email ospite
  const emailMatch = testo.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g);
  const ospite_email = emailMatch
    ? (emailMatch.find(e => !e.includes('booking.com') && !e.includes('google')) ?? '')
    : '';

  // Telefono
  const telMatch = testo.match(/(?:telefono|phone|tel\.?|mobile|cellulare)[\s:]+([+\d\s\-().]{7,20})/i);
  const ospite_telefono = telMatch ? telMatch[1].trim() : '';

  // Numero ospiti
  const ospitiMatch = testo.match(/(?:adulti?|ospiti?|guests?|persone)[\s:]+(\d+)/i);
  const num_ospiti = ospitiMatch ? parseInt(ospitiMatch[1]) : 1;

  return {
    booking_number,
    ospite_nome,
    check_in,
    check_out,
    camera_nome,
    importo,
    ospite_email,
    ospite_telefono,
    num_ospiti,
    gmail_message_id: messageId,
  };
}

// ── Setup tabella tracking ─────────────────────────────────────────────────
export async function setupGmailSyncTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS gmail_sync (
      message_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL,
      booking_number TEXT,
      prenotazione_id TEXT
    )
  `;
}

// ── Fetch email da Gmail ───────────────────────────────────────────────────
export async function fetchEmailBooking(): Promise<DatiPrenotazioneEmail[]> {
  await setupGmailSyncTable();

  const auth   = getAuth();
  const gmail  = google.gmail({ version: 'v1', auth: auth as never });

  // Cerca email da Booking.com non ancora processate
  const processati = await sql`SELECT message_id FROM gmail_sync`;
  const idsProcessati = new Set(processati.map((r) => r.message_id as string));

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:booking.com subject:(prenotazione OR reservation OR booking)',
    maxResults: 50,
  });

  const messaggi = res.data.messages ?? [];
  const nuovi = messaggi.filter((m) => m.id && !idsProcessati.has(m.id));

  const risultati: DatiPrenotazioneEmail[] = [];

  for (const msg of nuovi) {
    if (!msg.id) continue;

    const dettaglio = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    // Estrai corpo email
    let corpo = '';
    const payload = dettaglio.data.payload;
    const parts = payload?.parts ?? [payload];

    for (const part of parts) {
      if (!part) continue;
      const mime = part.mimeType ?? '';
      if (mime === 'text/plain' || mime === 'text/html') {
        const data = part.body?.data;
        if (data) {
          const decoded = Buffer.from(data, 'base64').toString('utf-8');
          corpo += mime === 'text/html' ? stripHtml(decoded) : decoded;
        }
      }
      // Gestisci multipart annidati
      for (const subpart of part.parts ?? []) {
        const subMime = subpart.mimeType ?? '';
        const subData = subpart.body?.data;
        if (subData && (subMime === 'text/plain' || subMime === 'text/html')) {
          const decoded = Buffer.from(subData, 'base64').toString('utf-8');
          corpo += subMime === 'text/html' ? stripHtml(decoded) : decoded;
        }
      }
    }

    const dati = parseEmailBooking(corpo, msg.id);
    if (dati) risultati.push(dati);
  }

  return risultati;
}

// ── Marca email come processata ────────────────────────────────────────────
export async function marcaProcessata(messageId: string, bookingNumber: string, prenotazioneId: string): Promise<void> {
  await sql`
    INSERT INTO gmail_sync (message_id, processed_at, booking_number, prenotazione_id)
    VALUES (${messageId}, ${new Date().toISOString()}, ${bookingNumber}, ${prenotazioneId})
    ON CONFLICT (message_id) DO NOTHING
  `;
}
