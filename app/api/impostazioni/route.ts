import { NextRequest, NextResponse } from 'next/server';
import { leggiImpostazioni, scriviImpostazioni } from '@/lib/ical';

export async function GET() {
  return NextResponse.json(await leggiImpostazioni());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const imp = await leggiImpostazioni();
  if (body.ical_urls !== undefined) imp.ical_urls = body.ical_urls;
  if (body.nomi_camere !== undefined) imp.nomi_camere = body.nomi_camere;
  if (body.google_sheets_abilitato !== undefined) imp.google_sheets_abilitato = body.google_sheets_abilitato;
  await scriviImpostazioni(imp);
  return NextResponse.json(imp);
}
