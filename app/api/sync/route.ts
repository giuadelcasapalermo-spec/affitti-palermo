import { NextResponse } from 'next/server';
import { sincronizzaTutti } from '@/lib/ical';
import { arricchisciPrenotazioniDaSheetsAll } from '@/lib/googlesheets';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';
import { fetchEmailBooking, marcaProcessata } from '@/lib/gmail';
import { leggiImpostazioni } from '@/lib/ical';
import { CAMERE } from '@/lib/types';
import { randomUUID } from 'crypto';
import { addDays, parseISO, format } from 'date-fns';

async function dedupPrenotazioniIcal(): Promise<number> {
  const prenotazioni = await leggiPrenotazioni();
  const manuali = prenotazioni.filter(p => !p.ical_uid && p.stato !== 'cancellata');
  const chiaviCamera = new Set(manuali.map(p => `${p.camera_id}|${p.check_in}|${p.check_out}`));
  const chiaviNome = new Set(
    manuali
      .filter(p => p.ospite_nome?.trim())
      .map(p => `${p.ospite_nome.toLowerCase().trim()}|${p.check_in}|${p.check_out}`)
  );
  const doppioni = prenotazioni.filter(p => {
    if (!p.ical_uid) return false;
    return (
      chiaviCamera.has(`${p.camera_id}|${p.check_in}|${p.check_out}`) ||
      (p.ospite_nome?.trim() &&
        chiaviNome.has(`${p.ospite_nome.toLowerCase().trim()}|${p.check_in}|${p.check_out}`))
    );
  });
  if (doppioni.length > 0) {
    const idsRimuovere = new Set(doppioni.map(p => p.id));
    await scriviPrenotazioni(prenotazioni.filter(p => !idsRimuovere.has(p.id)));
  }
  return doppioni.length;
}

async function sincronizzaGmail(): Promise<{ importate: number; aggiornate: number; cancellate: number; dettagli: string[] }> {
  const emails = await fetchEmailBooking();
  if (emails.length === 0) return { importate: 0, aggiornate: 0, cancellate: 0, dettagli: [] };

  const prenotazioni = await leggiPrenotazioni();
  const impostazioni = await leggiImpostazioni();

  // Mappa booking_number → prenotazione (cerca in note, ical_uid, e UID iCal con numero embedded)
  const mappaBooking = new Map<string, string>();
  for (const p of prenotazioni) {
    const daNota = p.note?.match(/BK:(\d+)/)?.[1];
    const daUid = p.ical_uid?.replace('gmail-', '');
    const daUidIcal = p.ical_uid?.match(/(\d{9,12})/)?.[1]; // es. "5581070573@booking.com"
    for (const k of [daNota, daUid, daUidIcal]) {
      if (k) mappaBooking.set(k, p.id);
    }
  }

  let importate = 0;
  let aggiornate = 0;
  let cancellate = 0;
  const dettagli: string[] = [];
  let changed = false;

  for (const email of emails) {

    // ── Cancellazioni ──────────────────────────────────────────────────────
    if (email.tipo === 'cancellata') {
      const idEsistente = mappaBooking.get(email.booking_number);
      if (idEsistente) {
        const p = prenotazioni.find(x => x.id === idEsistente);
        if (p && p.stato !== 'cancellata') {
          p.stato = 'cancellata';
          cancellate++;
          changed = true;
          dettagli.push(`${email.booking_number}: cancellata ✓`);
        }
      }
      await marcaProcessata(email.gmail_message_id, email.booking_number, idEsistente ?? '');
      continue;
    }

    // ── Prenotazione già esistente: aggiorna se nome è generico ───────────
    if (mappaBooking.has(email.booking_number)) {
      const idEsistente = mappaBooking.get(email.booking_number)!;
      const p = prenotazioni.find(x => x.id === idEsistente);

      if (p) {
        let updated = false;
        if (p.ospite_nome === 'Ospite Booking.com' && email.ospite_nome !== 'Ospite Booking.com') {
          p.ospite_nome = email.ospite_nome;
          updated = true;
        }
        if (!p.ospite_telefono && email.ospite_telefono) {
          p.ospite_telefono = email.ospite_telefono;
          updated = true;
        }
        if (!p.ospite_email && email.ospite_email) {
          p.ospite_email = email.ospite_email;
          updated = true;
        }
        if (p.importo_totale === 0 && email.importo > 0) {
          p.importo_totale = email.importo;
          updated = true;
        }
        if (!p.tassa_soggiorno && email.tassa_soggiorno > 0) {
          p.tassa_soggiorno = email.tassa_soggiorno;
          updated = true;
        }
        if (updated) {
          aggiornate++;
          changed = true;
          dettagli.push(`${email.booking_number}: aggiornata (${p.ospite_nome})`);
        }
      }

      await marcaProcessata(email.gmail_message_id, email.booking_number, idEsistente);
      continue;
    }

    // ── Nuova prenotazione ─────────────────────────────────────────────────
    if (!email.check_in) {
      dettagli.push(`${email.booking_number}: check-in mancante, saltata`);
      continue;
    }

    const check_out = email.check_out ?? format(addDays(parseISO(email.check_in), 1), 'yyyy-MM-dd');
    const checkoutPlaceholder = !email.check_out;

    let camera_id = 1;
    const nomeCamera = email.camera_nome.toLowerCase();
    if (email.camera_nome) {
      for (const [id, nome] of Object.entries(impostazioni.nomi_camere ?? {})) {
        if (nomeCamera.includes(nome.toLowerCase()) || nome.toLowerCase().includes(nomeCamera)) {
          camera_id = Number(id); break;
        }
      }
      if (camera_id === 1) {
        for (const cam of CAMERE) {
          if (nomeCamera.includes(cam.nome.toLowerCase())) { camera_id = cam.id; break; }
        }
      }
    }

    const id = randomUUID();
    prenotazioni.push({
      id, camera_id,
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
    changed = true;
    dettagli.push(
      `${email.booking_number}: ${email.ospite_nome} (${email.check_in} → ${check_out}${checkoutPlaceholder ? ' ⚠️' : ''})`
    );
  }

  if (changed) await scriviPrenotazioni(prenotazioni);

  return { importate, aggiornate, cancellate, dettagli };
}

export async function POST() {
  const imp = await leggiImpostazioni();
  const risultatiIcal = await sincronizzaTutti();
  const doppioniRimossi = await dedupPrenotazioniIcal();
  const risultatiGmail = await sincronizzaGmail();
  const prenotazioniArricchite = imp.google_sheets_abilitato
    ? await arricchisciPrenotazioniDaSheetsAll().catch(() => 0)
    : 0;

  return NextResponse.json({
    ok: true,
    risultati: risultatiIcal,
    doppioniRimossi,
    gmail: risultatiGmail,
    prenotazioniArricchite,
  });
}
