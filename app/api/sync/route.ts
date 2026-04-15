import { NextResponse } from 'next/server';
import { sincronizzaTutti } from '@/lib/ical';
import { dedupPrenotazioniIcal } from '@/lib/googlesheets';

export async function POST() {
  const risultati = await sincronizzaTutti();
  const doppioniRimossi = await dedupPrenotazioniIcal();
  return NextResponse.json({ ok: true, risultati, doppioniRimossi });
}
