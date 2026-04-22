import { NextResponse } from 'next/server';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import { leggiImpostazioni } from '@/lib/ical';
import { CAMERE } from '@/lib/types';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

function toIso(d?: string): string {
  if (!d) return '';
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errore: 'Body non valido' }, { status: 400 });
  }

  // Beds24 può inviare un array o un singolo oggetto
  const bookings: Record<string, unknown>[] = Array.isArray(body) ? body : [body];

  const [prenotazioniDB, impostazioni] = await Promise.all([
    leggiPrenotazioni(),
    leggiImpostazioni(),
  ]);

  const mappaBooking = new Map<string, typeof prenotazioniDB[0]>();
  for (const p of prenotazioniDB) {
    const bk = p.note?.match(/BK:(\d+)/)?.[1] ?? p.ical_uid?.replace('booking-', '');
    if (bk) mappaBooking.set(bk, p);
  }

  let aggiornate = 0;
  let create = 0;

  for (const b of bookings) {
    const bookingNum = String(b.channelRef ?? b.bookId ?? b.id ?? '');
    const checkIn  = toIso(String(b.checkIn  ?? b.arrival  ?? b.firstNight ?? ''));
    const checkOut = toIso(String(b.checkOut ?? b.departure ?? b.lastNight  ?? ''));
    const nomeCalcolato = (b.guestName as string | undefined)
      ?? `${String(b.guestFirstName ?? b.firstName ?? '')} ${String(b.guestLastName ?? b.lastName ?? '')}`.trim();
    const ospiteNome = nomeCalcolato || 'Ospite Booking.com';
    const importo = Number(b.totalPrice ?? b.price ?? b.amount ?? 0);
    const email = String(b.guestEmail ?? b.email ?? '');
    const telefono = String(b.guestPhone ?? b.phone ?? '');

    if (!checkIn) continue;

    // Determina camera
    let camera_id = 1;
    const nomeCamera = String(b.roomName ?? b.unitName ?? '').toLowerCase();
    if (nomeCamera) {
      for (const [id, nome] of Object.entries(impostazioni.nomi_camere ?? {})) {
        if (nomeCamera.includes((nome as string).toLowerCase())) { camera_id = Number(id); break; }
      }
      if (camera_id === 1) {
        for (const cam of CAMERE) {
          if (nomeCamera.includes(cam.nome.toLowerCase())) { camera_id = cam.id; break; }
        }
      }
    }

    const esistente = (bookingNum ? mappaBooking.get(bookingNum) : null)
      ?? prenotazioniDB.find(p =>
          p.check_in === checkIn && p.camera_id === camera_id &&
          (!p.ospite_nome || p.ospite_nome === 'Ospite Booking.com')
        );

    if (esistente) {
      let aggiornata = false;
      if ((!esistente.ospite_nome || esistente.ospite_nome === 'Ospite Booking.com') && ospiteNome !== 'Ospite Booking.com') {
        esistente.ospite_nome = ospiteNome; aggiornata = true;
      }
      if (!esistente.importo_totale && importo > 0) { esistente.importo_totale = importo; aggiornata = true; }
      if (!esistente.ospite_email && email) { esistente.ospite_email = email; aggiornata = true; }
      if (!esistente.ospite_telefono && telefono) { esistente.ospite_telefono = telefono; aggiornata = true; }
      if (!esistente.check_out && checkOut) { esistente.check_out = checkOut; aggiornata = true; }
      if (bookingNum && !esistente.note?.includes('BK:')) {
        esistente.note = `BK:${bookingNum} - ${esistente.note ?? ''}`.trim(); aggiornata = true;
      }
      if (aggiornata) aggiornate++;
    } else {
      prenotazioniDB.push({
        id: randomUUID(),
        camera_id,
        ospite_nome: ospiteNome,
        ospite_email: email,
        ospite_telefono: telefono,
        check_in: checkIn,
        check_out: checkOut,
        importo_totale: importo,
        stato: 'confermata',
        note: bookingNum ? `BK:${bookingNum} - Webhook Beds24` : 'Webhook Beds24',
        created_at: new Date().toISOString(),
        fonte: 'ical',
        ical_uid: bookingNum ? `booking-${bookingNum}` : `beds24-${randomUUID()}`,
      });
      create++;
    }
  }

  if (aggiornate > 0 || create > 0) {
    await scriviPrenotazioni(prenotazioniDB);
  }

  return NextResponse.json({ ok: true, aggiornate, create });
}
