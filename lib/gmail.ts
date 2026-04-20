import { google } from 'googleapis';
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

// ── Mesi italiani + abbreviati ─────────────────────────────────────────────
const MESI: Record<string, string> = {
  // Nomi completi italiani
  gennaio: '01', febbraio: '02', marzo: '03', aprile: '04',
  maggio: '05', giugno: '06', luglio: '07', agosto: '08',
  settembre: '09', ottobre: '10', novembre: '11', dicembre: '12',
  // Abbreviati italiani
  gen: '01', feb: '02', mar: '03', apr: '04',
  mag: '05', giu: '06', lug: '07', ago: '08',
  set: '09', ott: '10', nov: '11', dic: '12',
  // Nomi completi inglesi
  january: '01', february: '02', march: '03',
  may: '05', june: '06', july: '07',
  september: '09', october: '10', december: '12',
  // Abbreviati inglesi
  jan: '01', aug: '08',
  // Condivisi ita/eng già coperti
  april: '04', august: '08', november: '11',
  jun: '06', jul: '07', oct: '10',
};

function parseData(testo: string): string | null {
  // Rimuovi giorno della settimana (es. "mercoledì, " o "Wednesday, ")
  const pulito = testo
    .replace(/^[\w\u00C0-\u024F]+[ì,àèéù]?,?\s*/i, '') // giorno italiano con accento
    .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*[,.]?\s*/i, '') // giorno inglese
    .trim();

  // Prova prima il testo pulito, poi quello originale
  for (const t of [pulito, testo]) {
    // "15 aprile 2026" o "15 apr 2026" o "15 apr. 2026"
    const m1 = t.match(/(\d{1,2})[°\s.]+(\w+)\.?\s+(\d{4})/i);
    if (m1) {
      const mese = MESI[m1[2].toLowerCase()];
      if (mese) return `${m1[3]}-${mese}-${m1[1].padStart(2, '0')}`;
    }

    // "April 15, 2026" o "Apr 15, 2026"
    const m2 = t.match(/(\w+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
    if (m2) {
      const mese = MESI[m2[1].toLowerCase()];
      if (mese) return `${m2[3]}-${mese}-${m2[2].padStart(2, '0')}`;
    }

    // "15/04/2026" o "15-04-2026"
    const m3 = t.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
    if (m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;

    // "2026-04-15" (ISO già ok)
    const m4 = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m4) return t.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  }

  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|td|th|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Estrazione ricorsiva corpo email (gestisce annidamento multiplo) ────────
type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

function estraiCorpo(part: GmailPart, testo = { plain: '', html: '' }): { plain: string; html: string } {
  const mime = part.mimeType ?? '';
  const data = part.body?.data;

  if (data) {
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    if (mime === 'text/plain') testo.plain += decoded + '\n';
    else if (mime === 'text/html') testo.html += decoded + '\n';
  }

  // Ricorsione su subparts (qualsiasi profondità)
  for (const subpart of part.parts ?? []) {
    estraiCorpo(subpart, testo);
  }

  return testo;
}

export interface DatiPrenotazioneEmail {
  booking_number: string;
  ospite_nome: string;
  check_in: string | null;
  check_out: string | null;
  camera_nome: string;
  importo: number;
  tassa_soggiorno: number;
  ospite_email: string;
  ospite_telefono: string;
  num_ospiti: number;
  gmail_message_id: string;
  _corpo_debug?: string; // prime 800 chars del testo estratto (solo per debug)
}

function parseEmailBooking(testo: string, messageId: string): DatiPrenotazioneEmail | null {
  // Numero prenotazione
  const numMatch = testo.match(/(?:numero\s+(?:di\s+)?prenotazione|booking\s+(?:number|id|no\.?)|reservation\s+(?:number|id)|n[°\.\s]*prenotazione|codice\s+prenotazione|n\.\s*prenotazione)[\s:]*([0-9]{6,12})/i)
    ?? testo.match(/\b([0-9]{10})\b/)
    ?? testo.match(/\b([0-9]{9})\b/);
  if (!numMatch) return null;
  const booking_number = numMatch[1];

  // Nome ospite
  const nomeMatch = testo.match(/(?:nome\s+(?:dell'?ospite|ospite|del\s+cliente)|guest\s+name|ospite\s*[:\-]|cliente\s*[:\-])[\s:]+([A-ZÀÁÂÃÄÅÆÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜ][a-zA-ZÀ-ÿ\s'-]{2,40}?)(?:\n|,|\s{2,}|\|)/i);
  const ospite_nome = nomeMatch ? nomeMatch[1].trim() : 'Ospite Booking.com';

  // ── Date: cerca keyword su riga, poi il valore (stesso rigo o rigo successivo) ──
  let check_in: string | null = null;
  let check_out: string | null = null;

  // Pattern esteso: keyword poi valore (stesso rigo o rigo seguente)
  const datePattern = (keywords: string) =>
    new RegExp(`(?:${keywords})[:\\s]*([^\\n]{3,40})(?:\\n([^\\n]{3,40}))?`, 'i');

  const arrivoRe  = datePattern('arrivo|check[.\\- ]?in|arrival|data\\s+di\\s+arrivo|data\\s+check.?in');
  const partenzaRe = datePattern('partenza|check[.\\- ]?out|departure|data\\s+di\\s+partenza|data\\s+check.?out');

  const am = testo.match(arrivoRe);
  if (am) {
    check_in = parseData(am[1]) ?? (am[2] ? parseData(am[2]) : null);
  }

  const pm = testo.match(partenzaRe);
  if (pm) {
    check_out = parseData(pm[1]) ?? (pm[2] ? parseData(pm[2]) : null);
  }

  // Fallback: cerca tutte le date nel testo e usa la prima come check_in, seconda come check_out
  if (!check_in || !check_out) {
    const dateRegex = /\b(\d{1,2})\s+(\w+)\.?\s+(\d{4})\b/gi;
    const dateMatch = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
    const tutteDate: string[] = [];

    let m;
    while ((m = dateRegex.exec(testo)) !== null) {
      const mese = MESI[m[2].toLowerCase()];
      if (mese) tutteDate.push(`${m[3]}-${mese}-${m[1].padStart(2, '0')}`);
    }
    while ((m = dateMatch.exec(testo)) !== null) {
      tutteDate.push(`${m[3]}-${m[2]}-${m[1]}`);
    }

    // Dedup e ordina
    const uniche = [...new Set(tutteDate)].sort();
    if (!check_in && uniche.length > 0) check_in = uniche[0];
    if (!check_out && uniche.length > 1) check_out = uniche[1];
  }

  // Camera
  const cameraMatch = testo.match(/(?:camera|room|stanza|unit[àa]|tipo\s+di\s+(?:stanza|camera)|sistemazione)[\s:]+([^\n]{3,60})/i);
  const camera_nome = cameraMatch ? cameraMatch[1].trim() : '';

  // ── Importi ──────────────────────────────────────────────────────────────
  // Helper: estrae il primo numero (es. "€ 250,00" o "EUR 250.00" o "250,00 €")
  function estraiImporto(riga: string): number {
    const m = riga.match(/(?:EUR|€|£|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:EUR|€)?/i);
    return m ? parseFloat(m[1].replace(',', '.')) : 0;
  }

  // Tassa di soggiorno (prima, perché è più specifica)
  const tassaMatch = testo.match(
    /tassa\s+(?:di\s+)?soggiorno[\s:€£$EUR]*([0-9]+(?:[.,][0-9]{1,2})?)|city\s+(?:tax|fee)[\s:€£$EUR]*([0-9]+(?:[.,][0-9]{1,2})?)|tourist\s+tax[\s:€£$EUR]*([0-9]+(?:[.,][0-9]{1,2})?)/i
  );
  const tassa_soggiorno = tassaMatch
    ? parseFloat((tassaMatch[1] ?? tassaMatch[2] ?? tassaMatch[3]).replace(',', '.'))
    : 0;

  // Importo soggiorno (escludi righe che contengono "tassa" o "tax")
  const righe = testo.split('\n');
  let importo = 0;

  // 1. Cerca "importo/costo/prezzo soggiorno" esplicitamente
  const soggiornMatch = testo.match(
    /(?:importo|costo|prezzo)\s+(?:del\s+)?soggiorno[\s:]*(?:EUR|€|£|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i
  ) ?? testo.match(
    /accommodation\s+(?:cost|price|charge|total)[\s:]*(?:EUR|€|£|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i
  );

  if (soggiornMatch) {
    importo = parseFloat(soggiornMatch[1].replace(',', '.'));
  } else {
    // 2. Cerca "totale" o "importo totale" (escludendo righe con tassa)
    for (const riga of righe) {
      const lc = riga.toLowerCase();
      if (lc.includes('tassa') || lc.includes('tax') || lc.includes('turistica')) continue;
      if (/(?:totale|total(?:\s+amount)?|importo\s+totale|prezzo\s+totale)\b/i.test(riga)) {
        const v = estraiImporto(riga);
        if (v > 0) { importo = v; break; }
      }
    }
  }

  // 3. Fallback generico: primo importo trovato (escluso tassa)
  if (importo === 0) {
    for (const riga of righe) {
      const lc = riga.toLowerCase();
      if (lc.includes('tassa') || lc.includes('tax') || lc.includes('turistica')) continue;
      if (/(?:importo|price|prezzo|valore|costo|amount)\b/i.test(riga)) {
        const v = estraiImporto(riga);
        if (v > 0) { importo = v; break; }
      }
    }
  }

  // Email ospite
  const emailMatch = testo.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g);
  const ospite_email = emailMatch
    ? (emailMatch.find(e =>
        !e.includes('booking.com') &&
        !e.includes('google') &&
        !e.includes('noreply') &&
        !e.includes('no-reply')
      ) ?? '')
    : '';

  // Telefono
  const telMatch = testo.match(/(?:telefono|phone|tel\.?|mobile|cellulare)[\s:]+([+\d\s\-().]{7,20})/i);
  const ospite_telefono = telMatch ? telMatch[1].trim() : '';

  // Numero ospiti
  const ospitiMatch = testo.match(/(?:adulti?|ospiti?|guests?|persone|n\.?\s*(?:di\s+)?ospiti)[\s:]+(\d+)/i);
  const num_ospiti = ospitiMatch ? parseInt(ospitiMatch[1]) : 1;

  return {
    booking_number,
    ospite_nome,
    check_in,
    check_out,
    camera_nome,
    importo,
    tassa_soggiorno,
    ospite_email,
    ospite_telefono,
    num_ospiti,
    gmail_message_id: messageId,
    _corpo_debug: testo.slice(0, 800),
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

  const processati = await sql`SELECT message_id FROM gmail_sync`;
  const idsProcessati = new Set(processati.map((r) => r.message_id as string));

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:booking.com',
    maxResults: 100,
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

    const payload = dettaglio.data.payload as GmailPart | undefined;
    if (!payload) continue;

    const { plain, html } = estraiCorpo(payload);
    // Preferisci testo plain; fallback su HTML strippato
    const corpo = plain.trim() || stripHtml(html);

    if (!corpo.trim()) continue;

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
