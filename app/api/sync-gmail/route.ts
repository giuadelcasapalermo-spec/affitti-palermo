import { NextResponse } from 'next/server';
import { fetchEmailBooking, marcaProcessata } from '@/lib/gmail';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import sql from '@/lib/postgres';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';
  const reset = url.searchParams.get('reset') === '1';

  // Se reset=1, svuota tutta la gmail_sync per forzare ri-scansione completa
  if (reset) {
    await sql`DELETE FROM gmail_sync`;
  }

  const emails = await fetchEmailBooking();

  if (emails.length === 0) {
    return NextResponse.json({ ok: true, importate: 0, messaggio: 'Nessuna nuova email' });
  }

  const prenotazioni = await leggiPrenotazioni();

  // Mappa booking_number → prenotazione esistente (cercata nelle note e nell'ical_uid)
  const mappaBooking = new Map<string, string>(); // booking_number → id prenotazione
  for (const p of prenotazioni) {
    const bk = p.note?.match(/BK:(\d+)/)?.[1] ?? p.ical_uid?.replace('gmail-', '');
    if (bk) mappaBooking.set(bk, p.id);
  }

  let importate = 0;
  let cancellate = 0;
  const dettagli: string[] = [];
  const debugInfo: Record<string, string> = {};

  for (const email of emails) {
    // ── Cancellazioni ──────────────────────────────────────────────────────
    if (email.tipo === 'cancellata') {
      const idEsistente = mappaBooking.get(email.booking_number);
      if (idEsistente) {
        const p = prenotazioni.find(x => x.id === idEsistente);
        if (p && p.stato !== 'cancellata') {
          p.stato = 'cancellata';
          cancellate++;
          dettagli.push(`${email.booking_number}: cancellata ✓`);
        }
      }
      await marcaProcessata(email.gmail_message_id, email.booking_number, idEsistente ?? '');
      continue;
    }

    // ── Prenotazione già abbinata a questo booking_number: nulla da fare ────
    // (Booking.com non include più nome/importo/camera nel corpo dell'email:
    // non c'è altro dato da aggiungere in questo passaggio successivo.)
    if (mappaBooking.has(email.booking_number)) {
      await marcaProcessata(email.gmail_message_id, email.booking_number, mappaBooking.get(email.booking_number)!);
      dettagli.push(`${email.booking_number}: già abbinata`);
      continue;
    }

    if (!email.check_in) {
      dettagli.push(`${email.booking_number}: check-in mancante, saltata`);
      if (debug) debugInfo[email.booking_number] = email._corpo_debug ?? '(vuoto)';
      continue;
    }

    // ── Abbina al blocco iCal con lo stesso check-in ────────────────────────
    // L'email non porta più camera/nome/importo: la camera certa arriva solo dalla
    // sync iCal (che crea già il blocco con camera e date reali). Qui ci limitiamo
    // ad agganciare il numero di prenotazione al blocco corrispondente, per riferimento.
    // Se il blocco iCal non esiste ancora (sync non ancora passata) o è ambiguo
    // (più camere con check-in lo stesso giorno), non creiamo nulla "alla cieca":
    // verrà agganciato a un prossimo giro, o resta visibile come "da completare".
    const candidati = prenotazioni.filter(p =>
      p.check_in === email.check_in &&
      p.fonte === 'ical' &&
      p.stato !== 'cancellata' &&
      !p.note?.includes('BK:')
    );

    if (candidati.length === 1) {
      const match = candidati[0];
      match.note = [match.note, `BK:${email.booking_number}`].filter(Boolean).join(' - ');
      mappaBooking.set(email.booking_number, match.id);
      await marcaProcessata(email.gmail_message_id, email.booking_number, match.id);
      importate++;
      dettagli.push(`${email.booking_number}: abbinata al blocco iCal del ${email.check_in} (camera ${match.camera_id}) ✓`);
    } else {
      await marcaProcessata(email.gmail_message_id, email.booking_number, '');
      dettagli.push(`${email.booking_number}: nessun blocco iCal univoco per ${email.check_in} (${candidati.length} candidati) — saltata`);
    }
  }

  if (importate > 0 || cancellate > 0) {
    await scriviPrenotazioni(prenotazioni);
  }

  return NextResponse.json({
    ok: true,
    importate,
    cancellate,
    dettagli,
    ...(debug ? { debugInfo } : {}),
  });
}
