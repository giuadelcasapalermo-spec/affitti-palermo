import { NextResponse } from 'next/server';
import { sincronizzaTutti, leggiImpostazioni, riconciliaBlocchiIcal } from '@/lib/ical';
import { arricchisciPrenotazioniDaSheetsAll, inserisciRicavoBookingNelFoglio } from '@/lib/googlesheets';
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

  // 2b. Crea la riga scheletro nel tab mensile per ogni nuovo blocco iCal appena importato —
  // la camera e le date sono già certe (da iCal); nome/importo/telefono restano vuoti, da
  // completare a mano nella pagina "Prenotazioni da completare".
  const righeScheletroCreate: string[] = [];
  if (sheetsConfigurato) {
    const nuoveICal = risultatiIcal.flatMap(r => r.nuove ?? []);
    for (const p of nuoveICal) {
      try {
        const r = await inserisciRicavoBookingNelFoglio({
          ospite_nome: '',
          check_in: p.check_in,
          check_out: p.check_out,
          camera_id: p.camera_id,
          importo_lordo: 0,
          note: 'Da completare',
        });
        if (r.inserita) righeScheletroCreate.push(`${p.check_in} camera ${p.camera_id} → ${r.tab} riga ${r.riga}`);
      } catch {
        // Non bloccare la sync iCal per un errore sul foglio — verrà ricreata al prossimo giro
      }
    }
  }

  // 3. Restringe/cancella i blocchi iCal ormai coperti da prenotazioni reali (manuali o da sheet)
  const blocchiRiconciliati = await riconciliaBlocchiIcal(struttura.id);

  return NextResponse.json({ ok: true, risultati: risultatiIcal, prenotazioniArricchite, righeSkippate, sheetsErrore, sheetsConfigurato, blocchiRiconciliati, righeScheletroCreate });
}
