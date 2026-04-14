import { NextResponse } from 'next/server';
import { sincronizzaTutti } from '@/lib/ical';

export async function POST() {
  const risultati = await sincronizzaTutti();
  return NextResponse.json({ ok: true, risultati });
}
