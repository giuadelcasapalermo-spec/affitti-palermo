import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStrutturaAttiva } from '@/lib/strutture';
import { leggiPrenotazioni } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { prenotazione_id } = await req.json();
    if (!prenotazione_id) {
      return NextResponse.json({ errore: 'prenotazione_id mancante' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const strutturaId = cookieStore.get('struttura_id')?.value;
    const struttura = await getStrutturaAttiva(strutturaId);

    const prenotazioni = await leggiPrenotazioni(struttura.id);
    const pren = prenotazioni.find(p => p.id === prenotazione_id);
    if (!pren) {
      return NextResponse.json({ errore: 'Prenotazione non trovata' }, { status: 404 });
    }
    if (!pren.ospite_telefono) {
      return NextResponse.json({ errore: 'Numero di telefono ospite mancante' }, { status: 400 });
    }

    const stanza = pren.camera_id;
    const imposta = pren.tassa_soggiorno ?? 0;
    const importaStr = imposta > 0 ? `€${imposta.toFixed(0)}` : '(da confermare)';

    const testo =
`Buongiorno ${pren.ospite_nome}, benvenuti! 🌸

Ecco tutte le informazioni utili per il vostro soggiorno presso di noi:

Check-in: la stanza è disponibile a partire dalle ore 15. Una volta arrivati in ${struttura.indirizzo || struttura.nome}, citofonate su GiuAdel casa Palermo e vi apriremo il portone da remoto. Salite al 4° piano e inserite il codice 315518 sul tastierino accanto alla porta. La vostra camera è la n. ${stanza}. All'interno della stanza, appese al dispositivo che attiva l'elettricità, troverete 3 chiavi (stanza, porta d'ingresso e portone su strada). Durante la permanenza vi chiediamo di utilizzare sempre le chiavi per rientrare.

Check-out: La camera va liberata entro le ore 11:00. Vi preghiamo di lasciare le chiavi riagganciate allo stacca-luce come le avete trovate. Per motivi organizzativi, purtroppo non possiamo offrire il servizio di deposito bagagli dopo il check-out.

Ascensore: Vi chiediamo la gentilezza di assicurarvi di chiudere bene entrambe le porte dell'ascensore dopo l'uso, per evitare di bloccarlo agli altri condomini.

Tassa di soggiorno: Vi chiediamo di lasciare ${importaStr} in contanti nel cassetto della scrivania, come previsto dalla prenotazione.

Frigorifero: In cucina avete a disposizione il ripiano del frigorifero contrassegnato dal numero della vostra camera (n. ${stanza}). Vi ricordiamo di svuotarlo al momento della partenza.

Parcheggio e ZTL: Siamo convenzionati con un parcheggio in Piazza Venezia (a circa 200 metri da noi) al costo di 15€ a notte. Potete contattare direttamente il proprietario, il Sig. Piero, al +39 393 324 8425. Per accedere alla ZTL è necessario un pass da 5€ al giorno (esclusi sabato e domenica), acquistabile direttamente dal Sig. Piero o negli Info Point del Comune.

Wi-Fi:

Rete: WINDTRE-ABE4F8

Password: 8v85j6fzej26cjm5

Per qualsiasi necessità durante il soggiorno, siamo a vostra completa disposizione.

Vi auguriamo un piacevole e sereno soggiorno a Palermo!

---

Good morning ${pren.ospite_nome}, welcome! 🌸

Here is all the information you need for your stay with us:

Check-in: the room is available from 3:00 PM. Once you arrive at ${struttura.indirizzo || struttura.nome}, ring the intercom for GiuAdel casa Palermo and we will open the main door remotely. Go up to the 4th floor and enter code 315518 on the keypad next to the door. Your room is n. ${stanza}. Inside the room, hanging on the device that activates the electricity, you will find 3 keys (room, entrance door and street door). During your stay, please always use the keys to get back in.

Check-out: The room must be vacated by 11:00 AM. Please leave the keys hanging back on the light-switch device as you found them. For organizational reasons, we unfortunately cannot offer luggage storage after check-out.

Elevator: Please kindly make sure to close both elevator doors properly after use, to avoid blocking it for the other residents.

City tax: Please leave ${importaStr} in cash in the desk drawer, as stated in the booking.

Fridge: In the kitchen you have a fridge shelf marked with your room number (n. ${stanza}) available for your use. Please remember to empty it upon departure.

Parking and ZTL: We have an agreement with a parking facility in Piazza Venezia (about 200 meters from us) at a cost of €15 per night. You can contact the owner, Mr. Piero, directly at +39 393 324 8425. To access the ZTL a €5 per day pass is required (excluding Saturday and Sunday), which you can purchase directly from Mr. Piero or at the Municipality's Info Points.

Wi-Fi:

Network: WINDTRE-ABE4F8

Password: 8v85j6fzej26cjm5

For any needs during your stay, we are fully at your disposal.

We wish you a pleasant and peaceful stay in Palermo!`;

    return NextResponse.json({ ok: true, testo, telefono: pren.ospite_telefono });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ errore: msg }, { status: 500 });
  }
}
