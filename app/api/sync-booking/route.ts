import { NextResponse } from 'next/server';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import { leggiImpostazioni } from '@/lib/ical';
import { CAMERE } from '@/lib/types';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

interface Beds24Booking {
  bookId?: number | string;
  propId?: number;
  roomId?: number | string;
  roomName?: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  checkIn?: string;   // YYYYMMDD
  checkOut?: string;  // YYYYMMDD
  arrival?: string;
  departure?: string;
  numAdult?: number;
  price?: number;
  totalPrice?: number;
  status?: string | number;
  channelRef?: string;  // numero prenotazione Booking.com
  referer?: string;
  info?: string;
}

function toIso(d?: string): string {
  if (!d) return '';
  // YYYYMMDD -> YYYY-MM-DD
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

function toYYYYMMDD(iso: string): string {
  return iso; // Beds24 v2 usa già YYYY-MM-DD
}

async function getBeds24Token(): Promise<string> {
  const refreshToken = process.env.BEDS24_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('BEDS24_REFRESH_TOKEN non configurato');
  const res = await fetch('https://beds24.com/api/v2/authentication/token', {
    headers: { refreshToken },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Auth Beds24 fallita: ${res.status}`);
  const json = await res.json();
  return json.token as string;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const dateFrom = body.date_from ?? new Date().toISOString().slice(0, 10);
  const dateTo   = body.date_to   ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let accessToken: string;
  try {
    accessToken = await getBeds24Token();
  } catch (e) {
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }

  const params = new URLSearchParams({
    arrivalFrom: toYYYYMMDD(dateFrom),
    arrivalTo:   toYYYYMMDD(dateTo),
  });

  let beds24Data: Beds24Booking[] = [];
  try {
    const res = await fetch(`https://beds24.com/api/v2/bookings?${params}`, {
      headers: { token: accessToken },
      cache: 'no-store',
    });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ ok: false, errore: `Beds24 errore ${res.status}: ${txt.slice(0, 200)}` }, { status: 502 });
    }
    const json = await res.json();
    beds24Data = Array.isArray(json) ? json : (json.data ?? json.bookings ?? []);
  } catch (e) {
    return NextResponse.json({ ok: false, errore: `Beds24 fetch fallito: ${String(e)}` }, { status: 502 });
  }

  if (beds24Data.length === 0) {
    return NextResponse.json({ ok: true, aggiornate: 0, create: 0, dettagli: ['Nessuna prenotazione in Beds24 per il periodo'] });
  }

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
  const dettagli: string[] = [];

  for (const b of beds24Data) {
    const bookingNum = String(b.channelRef ?? b.bookId ?? '');
    const checkIn  = toIso(b.checkIn  ?? b.arrival);
    const checkOut = toIso(b.checkOut ?? b.departure);
    const nomeCalcolato = b.guestName ?? `${b.guestFirstName ?? ''} ${b.guestLastName ?? ''}`.trim();
    const ospiteNome = nomeCalcolato || 'Ospite Booking.com';
    const importo = Number(b.totalPrice ?? b.price ?? 0);

    if (!checkIn) continue;

    // Determina camera
    let camera_id = 1;
    const nomeCamera = (b.roomName ?? '').toLowerCase();
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
      if (!esistente.importo_totale && importo > 0) {
        esistente.importo_totale = importo; aggiornata = true;
      }
      if (!esistente.ospite_email && b.guestEmail) {
        esistente.ospite_email = b.guestEmail; aggiornata = true;
      }
      if (!esistente.ospite_telefono && b.guestPhone) {
        esistente.ospite_telefono = b.guestPhone; aggiornata = true;
      }
      if (!esistente.check_out && checkOut) {
        esistente.check_out = checkOut; aggiornata = true;
      }
      if (bookingNum && !esistente.note?.includes('BK:')) {
        esistente.note = `BK:${bookingNum} - ${esistente.note ?? ''}`.trim(); aggiornata = true;
      }
      if (aggiornata) {
        aggiornate++;
        dettagli.push(`${bookingNum || checkIn}: aggiornata (${ospiteNome})`);
      }
    } else {
      prenotazioniDB.push({
        id: randomUUID(),
        camera_id,
        ospite_nome: ospiteNome,
        ospite_email: b.guestEmail ?? '',
        ospite_telefono: b.guestPhone ?? '',
        check_in: checkIn,
        check_out: checkOut,
        importo_totale: importo,
        stato: 'confermata',
        note: bookingNum ? `BK:${bookingNum} - Importata da Beds24` : 'Importata da Beds24',
        created_at: new Date().toISOString(),
        fonte: 'ical',
        ical_uid: bookingNum ? `booking-${bookingNum}` : `beds24-${b.bookId}`,
      });
      create++;
      dettagli.push(`${bookingNum || checkIn}: creata (${ospiteNome})`);
    }
  }

  if (aggiornate > 0 || create > 0) {
    await scriviPrenotazioni(prenotazioniDB);
  }

  return NextResponse.json({ ok: true, aggiornate, create, dettagli });
}
