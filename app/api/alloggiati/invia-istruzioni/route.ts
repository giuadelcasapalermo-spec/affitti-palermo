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
`Buongiorno ${pren.ospite_nome},
•    Check-in: Appena arrivati in ${struttura.indirizzo || struttura.nome} potete accedere citofonando nel pulsante con scritto GiuAdel casa Palermo e vi apriremo il portone in remoto. Salite al quarto piano e inserite il codice 315518 sul tastierino vicino alla porta. La stanza a voi assegnata è la numero ${stanza}. Dentro la vostra stanza trovate appese al sistema che attiva la luce tre chiavi (stanza - porta di ingresso - portone di giù). Durante il soggiorno vi preghiamo di non citofonare ma di utilizzare le chiavi fornite.
•    Check-out: La stanza deve essere lasciata entro le ore 11:00 del mattino. Lasciate le chiavi appese nella parete al sistema stacca luce come le avete trovate. Per motivi organizzativi non gestiamo il deposito dei bagagli nel giorno di check-out.
•    Utilizzo ascensore: Fate la massima attenzione a chiudere bene entrambe le porte dell'ascensore, potrebbero rimanere aperte causando disagi ai condomini del palazzo.
•    Tassa di soggiorno: Vi preghiamo di lasciare ${importaStr} in contanti nel cassetto della scrivania come tassa di soggiorno come previsto nella prenotazione booking.
•    Utilizzo frigorifero: Avete a disposizione un ripiano del frigo con il numero corrispondente a quello della vostra camera. Vi preghiamo di rimuovere le vostre cose durante il check-out.
•    Parcheggio e accesso zona ZTL: Abbiamo una convenzione con un parcheggio che ha un costo di 15€ a notte, si trova a Piazza Venezia a circa 200mt dalla struttura. Potete contattare direttamente il proprietario Sig. Piero al +39 393 324 8425. Per accedere al centro città è prevista la tassa ZTL che potete acquistare dal Sig. Piero o nei info point del comune di Palermo ad un costo aggiuntivo di 5€ al giorno (sabato e domenica esclusi).
•    Rete Wi-Fi: Nome rete WINDTRE-ABE4F8, password 8v85j6fzej26cjm5.
Grazie e buon soggiorno!

---

Good morning ${pren.ospite_nome},
•    Check-in: As soon as you arrive at ${struttura.indirizzo || struttura.nome} you can access it by calling the intercom button labeled GiuAdel casa Palermo, and we will open the main door remotely. Go up to the fourth floor and enter code 315518 on the keypad next to the door. Your assigned room is number ${stanza}. Inside your room, hanging on the system that activates the light, you will find three keys (room - entrance door - street door). During your stay, please do not use the intercom but use the keys provided instead.
•    Check-out: The room must be vacated by 11:00 AM. Please leave the keys hanging on the wall on the light-switch system as you found them. For organizational reasons, we do not offer luggage storage on the check-out day.
•    Elevator use: Please be very careful to close both elevator doors properly, as they might stay open and cause inconvenience to the building's residents.
•    City tax: Please leave ${importaStr} in cash in the desk drawer for the city tax, as stated in your Booking reservation.
•    Fridge use: You have a fridge shelf available with the number matching your room. Please remove your belongings at check-out.
•    Parking and ZTL access: We have an agreement with a parking facility costing €15 per night, located in Piazza Venezia about 200m from the property. You can contact the owner, Mr. Piero, directly at +39 393 324 8425. To access the city center, a ZTL fee applies, which you can purchase from Mr. Piero or at the Palermo municipality info points for an additional €5 per day (Saturdays and Sundays excluded).
•    Wi-Fi network: Name WINDTRE-ABE4F8, password 8v85j6fzej26cjm5.
Thank you and enjoy your stay!`;

    return NextResponse.json({ ok: true, testo, telefono: pren.ospite_telefono });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ errore: msg }, { status: 500 });
  }
}
