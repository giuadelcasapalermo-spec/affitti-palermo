import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import sql from '@/lib/postgres';

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const msgId = searchParams.get('id');

    const auth  = getAuth();
    const gmail = google.gmail({ version: 'v1', auth: auth as never });

    // Se richiesto un messaggio specifico, mostra il corpo completo
    if (msgId) {
      const dettaglio = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'full',
      });

      type GPart = { mimeType?: string|null; body?: {data?: string|null}|null; parts?: GPart[]|null };
      function estraiRicorsivo(part: GPart, acc: {plain: string; html: string}): void {
        const mime = part.mimeType ?? '';
        const data = part.body?.data;
        if (data) {
          const decoded = Buffer.from(data, 'base64').toString('utf-8');
          if (mime === 'text/plain') acc.plain += decoded + '\n';
          else if (mime === 'text/html') acc.html += decoded + '\n';
        }
        for (const sp of part.parts ?? []) estraiRicorsivo(sp, acc);
      }
      const acc = { plain: '', html: '' };
      estraiRicorsivo(dettaglio.data.payload as GPart, acc);
      const corpo = acc.plain.trim() || stripHtml(acc.html);

      // Test regex patterns
      const numMatch = corpo.match(/(?:numero\s+(?:di\s+)?prenotazione|booking\s+(?:number|id|no\.?)|reservation\s+(?:number|id)|n[°\.\s]*prenotazione|codice\s+prenotazione)[\s:]*([0-9]{6,12})/i)
        ?? corpo.match(/\b([0-9]{10})\b/)
        ?? corpo.match(/\b([0-9]{9})\b/);

      const arrivoMatch = corpo.match(/(?:arrivo|check.?in|arrival)[\s:]+([^\n]{5,30})/i);
      const partenzaMatch = corpo.match(/(?:partenza|check.?out|departure)[\s:]+([^\n]{5,30})/i);
      const nomeMatch = corpo.match(/(?:nome\s+(?:dell'ospite|ospite)|guest\s+name|ospite)[\s:]+([A-ZÀÁÂÃÄÅÆÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜ][a-zA-ZÀ-ÿ\s'-]{2,40}?)(?:\n|,|\s{2,}|\|)/i);

      return NextResponse.json({
        subject: dettaglio.data.payload?.headers?.find(h => h.name === 'Subject')?.value,
        from: dettaglio.data.payload?.headers?.find(h => h.name === 'From')?.value,
        corpo_preview: corpo.slice(0, 3000),
        parsed: {
          booking_number: numMatch?.[1] ?? null,
          nome: nomeMatch?.[1] ?? null,
          check_in_raw: arrivoMatch?.[1] ?? null,
          check_out_raw: partenzaMatch?.[1] ?? null,
        },
      });
    }

    // Lista email da booking.com
    const processati = await sql`SELECT message_id FROM gmail_sync`;
    const idsProcessati = new Set(processati.map((r) => r.message_id as string));

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:booking.com',
      maxResults: 50,
    });

    const messaggi = res.data.messages ?? [];

    // Carica subject/from per ogni messaggio
    const dettagli = await Promise.all(
      messaggi.slice(0, 30).map(async (m) => {
        if (!m.id) return null;
        try {
          const d = await gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          });
          const headers = d.data.payload?.headers ?? [];
          const get = (name: string) => headers.find(h => h.name === name)?.value ?? '';
          return {
            id: m.id,
            subject: get('Subject'),
            from: get('From'),
            date: get('Date'),
            processato: idsProcessati.has(m.id),
          };
        } catch {
          return { id: m.id, subject: '(errore lettura)', from: '', date: '', processato: false };
        }
      })
    );

    return NextResponse.json({
      totale_trovate: messaggi.length,
      gia_processate: idsProcessati.size,
      nuove: messaggi.filter(m => m.id && !idsProcessati.has(m.id)).length,
      email: dettagli.filter(Boolean),
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ errore: msg }, { status: 500 });
  }
}
