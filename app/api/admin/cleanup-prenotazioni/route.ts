import { NextResponse } from 'next/server';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';

export async function POST() {
  const tutte = await leggiPrenotazioni();
  const daMantenere = tutte.filter(p => !!p.ical_uid);
  const rimosse = tutte.filter(p => !p.ical_uid);

  await scriviPrenotazioni(daMantenere);

  return NextResponse.json({
    ok: true,
    rimosseTotale: rimosse.length,
    rimasteTotal: daMantenere.length,
    rimosse: rimosse.map(p => ({
      id: p.id,
      ospite: p.ospite_nome,
      camera_id: p.camera_id,
      check_in: p.check_in,
      check_out: p.check_out,
      fonte: p.fonte,
    })),
  });
}
