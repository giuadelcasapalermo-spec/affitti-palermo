import { NextResponse } from 'next/server';
import { fetchEmailBooking, marcaProcessata } from '@/lib/gmail';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import { leggiImpostazioni } from '@/lib/ical';
import { CAMERE } from '@/lib/types';
import { randomUUID } from 'crypto';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  const emails = await fetchEmailBooking();

  if (emails.length === 0) {
    return NextResponse.json({ ok: true, importate: 0, messaggio: 'Nessuna nuova email' });
  }

  const prenotazioni = await leggiPrenotazioni();
  const impostazioni = await leggiImpostazioni();
  const bookingNumbers = new Set(
    prenotazioni.map((p) => p.note?.match(/BK:(\d+)/)?.[1]).filter(Boolean)
  );

  let importate = 0;
  const dettagli: string[] = [];
  const debugInfo: Record<string, string> = {};

  for (const email of emails) {
    // Evita duplicati per numero prenotazione
    if (bookingNumbers.has(email.booking_number)) {
      await marcaProcessata(email.gmail_message_id, email.booking_number, '');
      continue;
    }

    if (!email.check_in || !email.check_out) {
      dettagli.push(`${email.booking_number}: date mancanti, saltata`);
      if (debug) debugInfo[email.booking_number] = email._corpo_debug ?? '(vuoto)';
      continue;
    }

    // Cerca camera_id dal nome camera
    let camera_id = 1;
    const nomeCamera = email.camera_nome.toLowerCase();
    for (const [id, nome] of Object.entries(impostazioni.nomi_camere ?? {})) {
      if (nomeCamera.includes(nome.toLowerCase()) || nome.toLowerCase().includes(nomeCamera)) {
        camera_id = Number(id);
        break;
      }
    }
    // Fallback: cerca nei nomi base delle camere
    if (camera_id === 1 && email.camera_nome) {
      for (const cam of CAMERE) {
        if (nomeCamera.includes(cam.nome.toLowerCase())) {
          camera_id = cam.id;
          break;
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
      check_out: email.check_out,
      importo_totale: email.importo,
      tassa_soggiorno: email.tassa_soggiorno || undefined,
      stato: 'confermata',
      note: `BK:${email.booking_number} - Importata da email`,
      created_at: new Date().toISOString(),
      fonte: 'ical',
      ical_uid: `gmail-${email.booking_number}`,
    });

    bookingNumbers.add(email.booking_number);
    await marcaProcessata(email.gmail_message_id, email.booking_number, id);
    importate++;
    dettagli.push(`${email.booking_number}: ${email.ospite_nome} (${email.check_in} → ${email.check_out})`);
  }

  if (importate > 0) {
    await scriviPrenotazioni(prenotazioni);
  }

  return NextResponse.json({ ok: true, importate, dettagli, ...(debug ? { debugInfo } : {}) });
}
