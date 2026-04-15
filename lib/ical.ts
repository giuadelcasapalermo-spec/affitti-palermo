import { format } from 'date-fns';
import { Prenotazione, Impostazioni } from './types';
import { leggiPrenotazioni, scriviPrenotazioni } from './db';
import { onVercel } from './github-storage';
import { leggiImpostazioniSheets, scriviImpostazioniSheets } from './googlesheets';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const IMPOSTAZIONI_PATH = path.join(process.cwd(), 'data', 'impostazioni.json');

export async function leggiImpostazioni(): Promise<Impostazioni> {
  if (onVercel) {
    return leggiImpostazioniSheets();
  }
  if (!fs.existsSync(IMPOSTAZIONI_PATH)) {
    return { ical_urls: {}, nomi_camere: {} };
  }
  return JSON.parse(fs.readFileSync(IMPOSTAZIONI_PATH, 'utf-8'));
}

export async function scriviImpostazioni(imp: Impostazioni): Promise<void> {
  if (onVercel) {
    await scriviImpostazioniSheets(imp);
    return;
  }
  fs.writeFileSync(IMPOSTAZIONI_PATH, JSON.stringify(imp, null, 2));
}

interface ICalEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
}

function parseIcalDate(val: string): Date {
  // Gestisce formati: 20240415, 20240415T120000Z, 20240415T120000
  const clean = val.replace(/[TZ]/g, '');
  const y = parseInt(clean.slice(0, 4));
  const mo = parseInt(clean.slice(4, 6)) - 1;
  const d = parseInt(clean.slice(6, 8));
  const h = clean.length >= 10 ? parseInt(clean.slice(8, 10)) : 0;
  const mi = clean.length >= 12 ? parseInt(clean.slice(10, 12)) : 0;
  return new Date(y, mo, d, h, mi);
}

function parseIcal(text: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  const lines = text
    .replace(/\r\n /g, '') // unfold continuation lines
    .replace(/\r\n\t/g, '')
    .split(/\r?\n/);

  let inEvent = false;
  let uid = '';
  let start: Date | null = null;
  let end: Date | null = null;
  let summary = '';

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      uid = '';
      start = null;
      end = null;
      summary = '';
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      if (uid && start && end) {
        events.push({ uid, start, end, summary });
      }
      continue;
    }
    if (!inEvent) continue;

    if (line.startsWith('UID:')) {
      uid = line.slice(4).trim();
    } else if (line.startsWith('DTSTART') ) {
      const val = line.split(':').slice(1).join(':').trim();
      start = parseIcalDate(val);
    } else if (line.startsWith('DTEND')) {
      const val = line.split(':').slice(1).join(':').trim();
      end = parseIcalDate(val);
    } else if (line.startsWith('SUMMARY:')) {
      summary = line.slice(8).trim();
    }
  }

  return events;
}

export interface SyncResult {
  camera_id: number;
  aggiunte: number;
  rimosse: number;
  errore?: string;
}

export async function sincronizzaCalendario(
  cameraId: number,
  url: string
): Promise<SyncResult> {
  let testo: string;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    testo = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    return { camera_id: cameraId, aggiunte: 0, rimosse: 0, errore: msg };
  }

  const eventiRemoti = parseIcal(testo);
  const prenotazioni = await leggiPrenotazioni();
  const esistentiIcal = prenotazioni.filter(
    (p) => p.camera_id === cameraId && p.fonte === 'ical'
  );

  const uidsRemoti = new Set(eventiRemoti.map((e) => e.uid));
  const daAggiungere: Prenotazione[] = [];

  for (const ev of eventiRemoti) {
    const giaPresente = esistentiIcal.find((p) => p.ical_uid === ev.uid);
    if (giaPresente) continue;

    const summaryLower = ev.summary.toLowerCase();
    const ospiteNome =
      ev.summary &&
      !summaryLower.includes('closed') &&
      !summaryLower.includes('blocked') &&
      !summaryLower.includes('not available')
        ? ev.summary
        : 'Ospite Booking.com';

    daAggiungere.push({
      id: randomUUID(),
      camera_id: cameraId,
      ospite_nome: ospiteNome,
      ospite_telefono: '',
      ospite_email: '',
      check_in: format(ev.start, 'yyyy-MM-dd'),
      check_out: format(ev.end, 'yyyy-MM-dd'),
      importo_totale: 0,
      stato: 'confermata',
      note: 'Importata da Booking.com (iCal)',
      created_at: new Date().toISOString(),
      fonte: 'ical',
      ical_uid: ev.uid,
    });
  }

  // Rimuovi prenotazioni iCal che non sono più nel feed remoto
  const idsDaRimuovere = new Set(
    esistentiIcal.filter((p) => !uidsRemoti.has(p.ical_uid!)).map((p) => p.id)
  );

  const aggiornate = [
    ...prenotazioni.filter((p) => !idsDaRimuovere.has(p.id)),
    ...daAggiungere,
  ];

  await scriviPrenotazioni(aggiornate);

  return {
    camera_id: cameraId,
    aggiunte: daAggiungere.length,
    rimosse: idsDaRimuovere.size,
  };
}

export async function sincronizzaTutti(): Promise<SyncResult[]> {
  const imp = await leggiImpostazioni();
  const risultati: SyncResult[] = [];

  for (const [idStr, url] of Object.entries(imp.ical_urls)) {
    if (!url?.trim()) continue;
    const res = await sincronizzaCalendario(Number(idStr), url);
    risultati.push(res);
  }

  try {
    imp.ultimo_sync = new Date().toISOString();
    await scriviImpostazioni(imp);
  } catch {
    // Ignora errori di scrittura timestamp
  }

  return risultati;
}
