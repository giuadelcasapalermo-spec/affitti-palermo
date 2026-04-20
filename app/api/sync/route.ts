import { NextResponse } from 'next/server';
import { sincronizzaTutti } from '@/lib/ical';
import { leggiPrenotazioni, scriviPrenotazioni } from '@/lib/db';

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

export async function POST() {
  const risultati = await sincronizzaTutti();
  const doppioniRimossi = await dedupPrenotazioniIcal();
  return NextResponse.json({ ok: true, risultati, doppioniRimossi });
}
