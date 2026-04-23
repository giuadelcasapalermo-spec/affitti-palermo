import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const oggi = () => new Date().toISOString().split('T')[0];

function buildPrompt(testo: string, tipo: string, camere: { id: number; nome: string }[]): string {
  const listaCamere = camere.map(c => `id=${c.id}: ${c.nome}`).join(', ');
  const anno = new Date().getFullYear();

  if (tipo === 'prenotazione') {
    return `Sei un assistente per una casa vacanze a Palermo. Analizza il testo dettato in italiano ed estrai i dati per una nuova prenotazione.

Camere disponibili: ${listaCamere}
Oggi: ${oggi()}
Anno corrente: ${anno}

Testo: "${testo}"

Regole:
- Se il testo menziona solo giorno/mese senza anno, usa ${anno}
- camera_id: scegli la camera più simile al nome detto (es. "rossa" → cerca Rossa, "gialla" → Gialla)
- ospite_nome: nome e cognome
- importo_totale e tassa_soggiorno: 0 se non menzionati
- stato: "confermata" se non specificato diversamente

Rispondi SOLO con JSON valido, nessun testo aggiuntivo:
{
  "camera_id": <numero>,
  "ospite_nome": "<nome cognome>",
  "ospite_telefono": "<telefono o stringa vuota>",
  "ospite_email": "<email o stringa vuota>",
  "check_in": "<YYYY-MM-DD>",
  "check_out": "<YYYY-MM-DD>",
  "importo_totale": <numero>,
  "tassa_soggiorno": <numero>,
  "stato": "confermata",
  "note": "<note o stringa vuota>"
}`;
  }

  if (tipo === 'uscita') {
    return `Sei un assistente per una casa vacanze a Palermo. Analizza il testo dettato ed estrai i dati per una nuova uscita/spesa.

Categorie disponibili: Pulizie, Utenze, Manutenzione, Forniture, Arredamento, Commissioni, Tasse, Pubblicità, Affitto, Altro
Camere disponibili: ${listaCamere || 'nessuna'} (usa null per spese generali)
Oggi: ${oggi()}
Anno corrente: ${anno}

Testo: "${testo}"

Rispondi SOLO con JSON valido, nessun testo aggiuntivo:
{
  "data": "<YYYY-MM-DD>",
  "descrizione": "<breve descrizione>",
  "categoria": "<una delle categorie>",
  "importo": <numero>,
  "camera_id": <numero o null>,
  "note": "<note o stringa vuota>"
}`;
  }

  if (tipo === 'entrata') {
    return `Sei un assistente per una casa vacanze a Palermo. Analizza il testo dettato ed estrai i dati per una nuova entrata/incasso.

Categorie disponibili: Booking.com, Airbnb, Privato, Altro
Camere disponibili: ${listaCamere || 'nessuna'} (usa null per entrate generali)
Oggi: ${oggi()}
Anno corrente: ${anno}

Testo: "${testo}"

Rispondi SOLO con JSON valido, nessun testo aggiuntivo:
{
  "data": "<YYYY-MM-DD>",
  "descrizione": "<breve descrizione>",
  "categoria": "<una delle categorie>",
  "importo": <numero>,
  "camera_id": <numero o null>,
  "note": "<note o stringa vuota>"
}`;
  }

  throw new Error('Tipo non valido');
}

export async function POST(request: NextRequest) {
  const { testo, tipo, camere = [] } = await request.json();

  if (!testo || !tipo) {
    return NextResponse.json({ errore: 'Parametri mancanti' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ errore: 'ANTHROPIC_API_KEY non configurata' }, { status: 500 });
  }

  let prompt: string;
  try {
    prompt = buildPrompt(testo, tipo, camere);
  } catch {
    return NextResponse.json({ errore: 'Tipo non valido' }, { status: 400 });
  }

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const json = JSON.parse(text);
    return NextResponse.json(json);
  } catch (err) {
    console.error('[voice/parse]', err);
    return NextResponse.json({ errore: 'Errore elaborazione AI' }, { status: 500 });
  }
}
