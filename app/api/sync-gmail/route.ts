import { NextResponse } from 'next/server';
import { fetchEmailBooking, marcaProcessata } from '@/lib/gmail';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import { leggiImpostazioni } from '@/lib/ical';
import { CAMERE } from '@/lib/types';
import { randomUUID } from 'crypto';
import { addDays, parseISO, format } from 'date-fns';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  const emails = await fetchEmailBooking();

  if (emails.length === 0) {
    return NextResponse.json({ ok: true, importate: 0, messaggio: 'Nessuna nuova email' });
  }

  const prenotazioni = await leggiPrenotazioni();
  const impostazioni = await leggiImpostazioni();

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

    // ── Nuove prenotazioni ─────────────────────────────────────────────────
    if (mappaBooking.has(email.booking_number)) {
      await marcaProcessata(email.gmail_message_id, email.booking_number, mappaBooking.get(email.booking_number)!);
      continue;
    }

    if (!email.check_in) {
      dettagli.push(`${email.booking_number}: check-in mancante, saltata`);
      if (debug) debugInfo[email.booking_number] = email._corpo_debug ?? '(vuoto)';
      continue;
    }

    // Se check-out manca, usa check-in + 1 come placeholder
    const check_out = email.check_out ?? format(addDays(parseISO(email.check_in), 1), 'yyyy-MM-dd');
    const checkoutPlaceholder = !email.check_out;

    // Cerca camera_id dal nome camera
    let camera_id = 1;
    const nomeCamera = email.camera_nome.toLowerCase();
    if (email.camera_nome) {
      for (const [id, nome] of Object.entries(impostazioni.nomi_camere ?? {})) {
        if (nomeCamera.includes(nome.toLowerCase()) || nome.toLowerCase().includes(nomeCamera)) {
          camera_id = Number(id);
          break;
        }
      }
      if (camera_id === 1) {
        for (const cam of CAMERE) {
          if (nomeCamera.includes(cam.nome.toLowerCase())) {
            camera_id = cam.id;
            break;
          }
        }
      }
    }

    const id = randomUUID();
    prenotazioni.push({
      id,
      camera_id,
      ospite_nome: email.ospite_nome,
      ospite_telefono: email.ospite_telefono,
      ospite_email: email.ospite_email,
      check_in: email.check_in,
      check_out,
      importo_totale: email.importo,
      tassa_soggiorno: email.tassa_soggiorno || undefined,
      stato: 'confermata',
      note: `BK:${email.booking_number} - Importata da email${checkoutPlaceholder ? ' (check-out da verificare)' : ''}`,
      created_at: new Date().toISOString(),
      fonte: 'ical',
      ical_uid: `gmail-${email.booking_number}`,
    });

    mappaBooking.set(email.booking_number, id);
    await marcaProcessata(email.gmail_message_id, email.booking_number, id);
    importate++;
    dettagli.push(
      `${email.booking_number}: ${email.ospite_nome} (${email.check_in} → ${check_out}${checkoutPlaceholder ? ' ⚠️ verifica checkout' : ''})`
    );
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
