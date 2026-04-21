import { NextResponse } from 'next/server';
import { leggiImpostazioni } from '@/lib/ical';

export async function GET() {
  const imp = await leggiImpostazioni();
  return NextResponse.json({
    googleSheetsAbilitato: imp.google_sheets_abilitato ?? false,
  });
}
