import { format } from 'date-fns';
import { Prenotazione, Impostazioni } from './types';
import { leggiPrenotazioni, scriviPrenotazioni } from './db';
import sql from './postgres';
import { randomUUID } from 'crypto';

const DEFAULT_PREZZI: Record<number, number> = { 1: 60, 2: 60, 3: 65, 4: 65, 5: 70 };

export async function leggiImpostazioni(): Promise<Impostazioni> {
  const rows = await sql`SELECT tipo, chiave, valore FROM impostazioni`;
  const imp: Impostazioni = { ical_urls: {}, nomi_camere: {}, prezzi_camere: {}, colori_camere: {}, num_camere: 5 };
  for (const row of rows) {
    const id = Number(row.chiave);
    if (row.tipo === 'ical' && !isNaN(id)) imp.ical_urls[id] = row.valore as string;
    else if (row.tipo === 'camera' && !isNaN(id)) imp.nomi_camere[id] = row.valore as string;
    else if (row.tipo === 'sync' && row.chiave === 'ultimo_sync') imp.ultimo_sync = row.valore as string;
    else if (row.tipo === 'config' && row.chiave === 'google_sheets_abilitato') imp.google_sheets_abilitato = row.valore === 'true';
    else if (row.tipo === 'config' && row.chiave === 'google_sheet_id') imp.google_sheet_id = row.valore as string;
    else if (row.tipo === 'config' && row.chiave === 'nome_app') imp.nome_app = row.valore as string;
    else if (row.tipo === 'config' && row.chiave === 'logo_url') imp.logo_url = row.valore as string;
    else if (row.tipo === 'config' && row.chiave === 'num_camere') imp.num_camere = Number(row.valore);
    else if (row.tipo === 'camera_price' && !isNaN(id)) imp.prezzi_camere[id] = Number(row.valore);
    else if (row.tipo === 'camera_color' && !isNaN(id)) imp.colori_camere[id] = row.valore as string;
  }
  // Se num_camere non ancora in DB, derivalo dai nomi_camere configurati
  const maxId = Math.max(0, ...Object.keys(imp.nomi_camere).map(Number));
  if (!rows.some(r => r.tipo === 'config' && r.chiave === 'num_camere')) {
    imp.num_camere = maxId > 0 ? maxId : 5;
  }
  // Fallback prezzi da default se non in DB
  for (let i = 1; i <= imp.num_camere; i++) {
    if (imp.prezzi_camere[i] === undefined) imp.prezzi_camere[i] = DEFAULT_PREZZI[i] ?? 60;
  }
  return imp;
}

export async function scriviImpostazioni(imp: Impostazioni): Promise<void> {
  for (const [id, url] of Object.entries(imp.ical_urls ?? {})) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('ical', ${id}, ${url})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  for (const [id, nome] of Object.entries(imp.nomi_camere ?? {})) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('camera', ${id}, ${nome})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.ultimo_sync) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('sync', 'ultimo_sync', ${imp.ultimo_sync})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.google_sheets_abilitato !== undefined) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('config', 'google_sheets_abilitato', ${String(imp.google_sheets_abilitato)})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.google_sheet_id !== undefined) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('config', 'google_sheet_id', ${imp.google_sheet_id})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.nome_app !== undefined) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('config', 'nome_app', ${imp.nome_app})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.logo_url !== undefined) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('config', 'logo_url', ${imp.logo_url})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.num_camere !== undefined) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('config', 'num_camere', ${String(imp.num_camere)})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  for (const [id, prezzo] of Object.entries(imp.prezzi_camere ?? {})) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('camera_price', ${id}, ${String(prezzo)})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  for (const [id, colore] of Object.entries(imp.colori_camere ?? {})) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('camera_color', ${id}, ${colore})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
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

// Blocco di "fine finestra di prenotabilità" che Booking.com ripubblica ogni giorno (stesso
// SUMMARY generico, durata sempre > 60 notti, identico su tutte le camere): non è una
// prenotazione reale, quindi non va importato.
// NB: Booking.com usa lo stesso SUMMARY generico ("CLOSED - Not available") sia per questo
// blocco sia per le prenotazioni reali (non pubblica mai il nome ospite in iCal) — il testo da
// solo non basta a distinguerli. In passato veniva scartato anche ogni evento con DTSTART =
// oggi (assumendo fosse sempre un altro tipo di blocco "rolling"), ma questo scartava anche le
// prenotazioni reali con check-in lo stesso giorno del sync (es. prenotazioni last-minute):
// nessun soggiorno reale supera invece i 60 notti, quindi la sola durata è un segnale
// inequivocabile e non genera falsi positivi.
const DURATA_MASSIMA_SOGGIORNO_GIORNI = 60;
function isBloccoGenerico(summary: string, start: Date, end: Date): boolean {
  const s = summary.toLowerCase();
  const isGenerico = s.includes('closed') || s.includes('blocked') || s.includes('not available');
  if (!isGenerico) return false;
  const notti = (end.getTime() - start.getTime()) / 86_400_000;
  return notti > DURATA_MASSIMA_SOGGIORNO_GIORNI;
}

export interface SyncResult {
  camera_id: number;
  aggiunte: number;
  rimosse: number;
  errore?: string;
  nuove?: Prenotazione[];
  /** Prenotazioni che erano 'cancellata' e il cui UID e' ricomparso nel feed: come le nuove,
   *  hanno bisogno di una riga sul foglio e di essere completate a mano. */
  riattivate?: Prenotazione[];
}

// ── UID iCal da ignorare permanentemente (blocchi/prenotazioni fantasma eliminate manualmente) ──
export async function leggiUidIgnorati(): Promise<Set<string>> {
  const rows = await sql`SELECT chiave FROM impostazioni WHERE tipo = 'ical_ignora'`;
  return new Set(rows.map((r) => r.chiave as string));
}

export async function ignoraUidIcal(uid: string, cameraId: number): Promise<void> {
  await sql`
    INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('ical_ignora', ${uid}, ${String(cameraId)})
    ON CONFLICT (tipo, chiave) DO NOTHING
  `;
}

export async function sincronizzaCalendario(
  cameraId: number,
  url: string,
  strutturaId: string
): Promise<SyncResult> {
  let testo: string;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CalendarBot/1.0; +https://affitti-brevi.vercel.app)',
        'Accept': 'text/calendar, text/plain, */*',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }
    testo = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    return { camera_id: cameraId, aggiunte: 0, rimosse: 0, errore: msg };
  }

  const eventiRemoti = parseIcal(testo);
  const remoteUids = new Set(eventiRemoti.map((e) => e.uid));
  const prenotazioni = await leggiPrenotazioni(strutturaId);
  const esistentiIcal = prenotazioni.filter(
    (p) => p.camera_id === cameraId && p.fonte === 'ical'
  );
  const uidIgnorati = await leggiUidIgnorati();

  // Prenotazioni il cui UID iCal non compare più nel feed: Booking.com a volte rigenera
  // l'UID di una prenotazione esistente quando viene modificata (es. il cliente la
  // completa/aggiorna), quindi prima di considerarle cancellate proviamo ad abbinarle a un
  // evento remoto "nuovo" con le stesse date, per non perdere il collegamento con
  // l'anagrafica alloggiati (prenotazione_id) già associato a queste prenotazioni
  const orfane = esistentiIcal.filter(
    (p) => !uidIgnorati.has(p.ical_uid ?? '') && !remoteUids.has(p.ical_uid ?? '')
  );
  const orfaneRiassegnate = new Set<string>();
  const oggi = format(new Date(), 'yyyy-MM-dd');

  const daAggiungere: Prenotazione[] = [];
  const riattivate: Prenotazione[] = [];
  const daAggiornare = new Map<string, Prenotazione>();

  for (const ev of eventiRemoti) {
    if (uidIgnorati.has(ev.uid)) continue;
    if (isBloccoGenerico(ev.summary, ev.start, ev.end)) continue; // blocco di disponibilità, non una prenotazione reale

    const summaryLower = ev.summary.toLowerCase();
    const ospiteNome =
      ev.summary &&
      !summaryLower.includes('closed') &&
      !summaryLower.includes('blocked') &&
      !summaryLower.includes('not available')
        ? ev.summary
        : 'Ospite Booking.com';

    const checkIn = format(ev.start, 'yyyy-MM-dd');
    const checkOut = format(ev.end, 'yyyy-MM-dd');

    // L'UID iCal di Booking.com identifica la finestra camera+periodo, non la singola
    // prenotazione: se un soggiorno viene cancellato e la stessa camera è riprenotata per le
    // stesse date, il feed ripubblica lo STESSO UID per un ospite diverso (verificato: le 5
    // camere del 16-18/10/2026 portano gli UID di una prenotazione cancellata a luglio).
    // Un UID già presente in locale ma marcato 'cancellata' va quindi riattivato e ripulito
    // dei dati del vecchio ospite: prima ogni sync lo trovava "già presente" e lo saltava
    // per sempre, così la prenotazione non compariva mai né in app né sul foglio.
    const giaPresente = esistentiIcal.find((p) => p.ical_uid === ev.uid);
    if (giaPresente) {
      if (giaPresente.stato === 'cancellata') {
        const precedente = [
          giaPresente.ospite_nome,
          giaPresente.importo_totale ? `€ ${giaPresente.importo_totale}` : '',
        ].filter(Boolean).join(' ');
        const riattivata: Prenotazione = {
          ...giaPresente,
          ospite_nome: ospiteNome,
          ospite_telefono: '',
          ospite_email: '',
          check_in: checkIn,
          check_out: checkOut,
          importo_totale: 0,
          tassa_soggiorno: undefined,
          stato: 'confermata',
          note: `Importata da Booking.com (iCal) — riattivata${precedente ? `, prima era: ${precedente}` : ''}`,
        };
        daAggiornare.set(giaPresente.id, riattivata);
        riattivate.push(riattivata);
      }
      continue;
    }

    const rinominata = orfane.find(
      (p) => !orfaneRiassegnate.has(p.id) && p.check_in === checkIn && p.check_out === checkOut
    );
    if (rinominata) {
      orfaneRiassegnate.add(rinominata.id);
      const riassegnata: Prenotazione = {
        ...rinominata,
        ospite_nome: ospiteNome,
        ical_uid: ev.uid,
        stato: rinominata.stato === 'cancellata' ? 'confermata' : rinominata.stato,
      };
      daAggiornare.set(rinominata.id, riassegnata);
      // Se era cancellata, per il foglio è a tutti gli effetti una prenotazione nuova
      if (rinominata.stato === 'cancellata') riattivate.push(riassegnata);
      continue;
    }

    daAggiungere.push({
      id: randomUUID(),
      struttura_id: strutturaId,
      camera_id: cameraId,
      ospite_nome: ospiteNome,
      ospite_telefono: '',
      ospite_email: '',
      check_in: checkIn,
      check_out: checkOut,
      importo_totale: 0,
      stato: 'confermata',
      note: 'Importata da Booking.com (iCal)',
      created_at: new Date().toISOString(),
      fonte: 'ical',
      ical_uid: ev.uid,
    });
  }

  // Prenotazioni iCal sparite dal feed (cancellate su Booking.com, e non riassegnate a un
  // nuovo UID sopra): marcale come 'cancellata' invece di eliminarle, per non rompere il
  // collegamento con l'anagrafica alloggiati (prenotazione_id) già associata a queste
  // prenotazioni.
  // IMPORTANTE: lo facciamo solo se il check-in è ancora futuro. Il feed di Booking.com
  // smette di includere una prenotazione appena il check-in è passato, anche se l'ospite
  // è ancora in casa (stessa "finestra scorrevole" dei blocchi generici) — quindi la sua
  // sparizione dal feed dopo il check-in non è un segnale affidabile di cancellazione reale.
  let rimosse = 0;
  const esistentiAggiornate = prenotazioni.map((p) => {
    const aggiornata = daAggiornare.get(p.id);
    if (aggiornata) return aggiornata;
    if (
      p.camera_id === cameraId &&
      p.fonte === 'ical' &&
      p.stato !== 'cancellata' &&
      p.check_in > oggi &&
      !uidIgnorati.has(p.ical_uid ?? '') &&
      !remoteUids.has(p.ical_uid ?? '')
    ) {
      rimosse++;
      return { ...p, stato: 'cancellata' as const };
    }
    return p;
  });

  const aggiornate = [...esistentiAggiornate, ...daAggiungere];
  await scriviPrenotazioni(aggiornate, strutturaId);

  return {
    camera_id: cameraId,
    aggiunte: daAggiungere.length,
    rimosse,
    nuove: daAggiungere,
    riattivate,
  };
}

// ── Riconcilia blocchi iCal con le prenotazioni reali (manuali/da sheet) ──────
// Il feed iCal gratuito di Booking.com esporta finestre di indisponibilità contigue,
// non singole prenotazioni: se due soggiorni sono consecutivi senza una notte libera
// in mezzo, Booking.com li unisce in un unico blocco (verificato sul feed reale — non
// è un problema del nostro parsing). Quando le prenotazioni reali più granulari
// (manuali o dal foglio) arrivano per la stessa camera, il blocco iCal "fantasma" che
// le copre resta comunque a coprire tutto il periodo, sovrapponendosi a loro.
// Qui, per ogni prenotazione iCal, calcoliamo quanto del suo periodo è già coperto da
// prenotazioni reali sulla stessa camera: se è coperto per intero la cancelliamo (è un
// doppione), se resta scoperta solo la parte iniziale o finale la restringiamo a quella —
// senza mai eliminare periodi non ancora confermati da nessuna fonte.
export async function riconciliaBlocchiIcal(struttura_id?: string): Promise<number> {
  const prenotazioni = await leggiPrenotazioni(struttura_id);
  const reali = prenotazioni.filter((p) => p.fonte !== 'ical' && p.stato !== 'cancellata');
  const ghosts = prenotazioni.filter((p) => p.fonte === 'ical' && p.stato !== 'cancellata');

  let modificate = 0;
  const daEliminareDelTutto = new Set<string>();

  for (const ghost of ghosts) {
    const sovrapposte = reali
      .filter(
        (p) =>
          p.camera_id === ghost.camera_id &&
          p.check_in < ghost.check_out &&
          p.check_out > ghost.check_in
      )
      .sort((a, b) => a.check_in.localeCompare(b.check_in));
    if (sovrapposte.length === 0) continue;

    // Unisce gli intervalli reali sovrapposti/adiacenti, poi li ritaglia al periodo del ghost
    const uniti: [string, string][] = [];
    for (const p of sovrapposte) {
      const ultimo = uniti[uniti.length - 1];
      if (ultimo && p.check_in <= ultimo[1]) {
        if (p.check_out > ultimo[1]) ultimo[1] = p.check_out;
      } else {
        uniti.push([p.check_in, p.check_out]);
      }
    }
    const coperti = uniti
      .map(([s, e]): [string, string] => [
        s < ghost.check_in ? ghost.check_in : s,
        e > ghost.check_out ? ghost.check_out : e,
      ])
      .filter(([s, e]) => s < e);

    // Calcola la parte del periodo del ghost non coperta da nessuna prenotazione reale
    const scoperti: [string, string][] = [];
    let cursore = ghost.check_in;
    for (const [s, e] of coperti) {
      if (s > cursore) scoperti.push([cursore, s]);
      if (e > cursore) cursore = e;
    }
    if (cursore < ghost.check_out) scoperti.push([cursore, ghost.check_out]);

    if (scoperti.length === 0) {
      // Coperto per intero da prenotazioni reali: è un doppione fantasma. Lo marchiamo
      // 'cancellata' e lo segnaliamo per l'eliminazione definitiva (sotto, dopo aver
      // verificato che non sia collegato a un'anagrafica alloggiati) — altrimenti resta
      // visibile come "duplicato" nelle liste che mostrano anche le prenotazioni cancellate.
      ghost.stato = 'cancellata';
      daEliminareDelTutto.add(ghost.id);
      modificate++;
    } else if (scoperti.length === 1) {
      const [s, e] = scoperti[0];
      const isPrefisso = s === ghost.check_in;
      const isSuffisso = e === ghost.check_out;
      if ((isPrefisso || isSuffisso) && (s !== ghost.check_in || e !== ghost.check_out)) {
        ghost.check_in = s;
        ghost.check_out = e;
        modificate++;
      }
      // se la parte scoperta è un "buco" in mezzo (coperta prima e dopo), non tocchiamo
      // il ghost: non sappiamo se il buco è reale o solo un limite del merge di Booking.
    }
    // più di una parte scoperta: caso ambiguo, non tocchiamo il ghost.
  }

  if (modificate === 0 && daEliminareDelTutto.size === 0) return 0;

  let daScrivere = prenotazioni;
  if (daEliminareDelTutto.size > 0) {
    const idsArray = Array.from(daEliminareDelTutto);
    const collegati = await sql`
      SELECT DISTINCT prenotazione_id FROM alloggiati WHERE prenotazione_id = ANY(${idsArray})
    `;
    const idsCollegati = new Set(collegati.map((r) => r.prenotazione_id as string));
    for (const id of idsCollegati) daEliminareDelTutto.delete(id); // mantiene il link anagrafica
    daScrivere = prenotazioni.filter((p) => !daEliminareDelTutto.has(p.id));
  }

  await scriviPrenotazioni(daScrivere, struttura_id);
  return modificate;
}

export async function sincronizzaTutti(icalUrls: Record<number, string>, strutturaId: string): Promise<SyncResult[]> {
  const risultati: SyncResult[] = [];

  for (const [idStr, url] of Object.entries(icalUrls)) {
    if (!url?.trim()) continue;
    const res = await sincronizzaCalendario(Number(idStr), url, strutturaId);
    risultati.push(res);
  }

  try {
    const imp = await leggiImpostazioni();
    imp.ultimo_sync = new Date().toISOString();
    await scriviImpostazioni(imp);
  } catch {
    // Ignora errori di scrittura timestamp
  }

  return risultati;
}
