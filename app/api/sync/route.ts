import { NextResponse } from 'next/server';
import { sincronizzaTutti, leggiImpostazioni, riconciliaBlocchiIcal } from '@/lib/ical';
import { arricchisciPrenotazioniDaSheetsAll, inserisciRicavoBookingNelFoglio } from '@/lib/googlesheets';
import { leggiPrenotazioni } from '@/lib/db';
import { cookies } from 'next/headers';
import { getStrutturaAttiva } from '@/lib/strutture';

export async function POST() {
  const cookieStore = await cookies();
  const strutturaId = cookieStore.get('struttura_id')?.value;
  const struttura = await getStrutturaAttiva(strutturaId);

  // 1. Import from iCal using struttura's ical_urls (aggiorna/marca cancellate per UID,
  // non cancella mai le prenotazioni esistenti: preserva l'id e il collegamento con l'anagrafica alloggiati)
  const risultatiIcal = await sincronizzaTutti(struttura.ical_urls, struttura.id);

  // 2. Google Sheets sync
  const imp = await leggiImpostazioni();
  const sheetsConfigurato = !!imp.google_sheet_id?.trim();
  let prenotazioniArricchite = 0;
  let righeSkippate: string[] = [];
  let sheetsErrore: string | null = null;
  if (sheetsConfigurato) {
    try {
      const res = await arricchisciPrenotazioniDaSheetsAll(struttura.id);
      prenotazioniArricchite = res.modificate;
      righeSkippate = res.saltate;
    } catch (err) {
      sheetsErrore = err instanceof Error ? err.message : 'Errore sconosciuto';
    }
  }

  // 3. Restringe/cancella i blocchi iCal ormai coperti da prenotazioni reali (manuali o da sheet)
  const blocchiRiconciliati = await riconciliaBlocchiIcal(struttura.id);

  // 4. Crea la riga scheletro nel tab mensile per ogni blocco iCal appena importato o
  // riattivato: camera e date sono certe (da iCal), mentre nome/importo/telefono restano
  // vuoti, da completare a mano nella pagina "Prenotazioni → Da completare".
  //
  // Va fatto DOPO la riconciliazione (punto 3), non prima: il feed gratuito di Booking.com
  // unisce i soggiorni consecutivi in un unico blocco, e la riconciliazione è ciò che scarta
  // quei blocchi-fantasma già coperti da prenotazioni reali. Creando le righe prima si
  // scriveva sul foglio una riga a zero per blocchi che venivano eliminati subito dopo
  // (es. il blocco 10→20/09 sulla Verde, coperto da 4 soggiorni reali), e sul foglio quella
  // riga restava per sempre. Perciò rileggiamo lo stato post-riconciliazione e inseriamo solo
  // per le prenotazioni ancora vive, con le date eventualmente ristrette dalla riconciliazione.
  const righeScheletroCreate: string[] = [];
  const righeScheletroErrori: string[] = [];
  if (sheetsConfigurato) {
    const daInserire = risultatiIcal.flatMap(r => [...(r.nuove ?? []), ...(r.riattivate ?? [])]);
    if (daInserire.length > 0) {
      const attuali = new Map((await leggiPrenotazioni(struttura.id)).map(p => [p.id, p]));
      for (const p of daInserire) {
        const viva = attuali.get(p.id);
        if (!viva || viva.stato === 'cancellata') continue; // scartata dalla riconciliazione
        try {
          const r = await inserisciRicavoBookingNelFoglio({
            ospite_nome: '',
            check_in: viva.check_in,
            check_out: viva.check_out,
            camera_id: viva.camera_id,
            importo_lordo: 0,
            note: 'Da completare',
          });
          if (r.inserita) righeScheletroCreate.push(`${viva.check_in} camera ${viva.camera_id} → ${r.tab} riga ${r.riga}`);
          else if (r.motivo && !r.motivo.startsWith('esiste già')) righeScheletroErrori.push(`${viva.check_in} camera ${viva.camera_id}: ${r.motivo}`);
        } catch (err) {
          // Non bloccare la sync iCal per un errore sul foglio, ma segnalarlo: la
          // prenotazione è già nel DB, quindi al prossimo giro non sarà più "nuova" e la
          // riga non verrebbe ritentata da sola.
          righeScheletroErrori.push(`${viva.check_in} camera ${viva.camera_id}: ${err instanceof Error ? err.message : 'errore sconosciuto'}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, risultati: risultatiIcal, prenotazioniArricchite, righeSkippate, sheetsErrore, sheetsConfigurato, blocchiRiconciliati, righeScheletroCreate, righeScheletroErrori });
}
