import { NextRequest, NextResponse } from 'next/server';
import { leggiImpostazioni, scriviImpostazioni } from '@/lib/ical';

export async function GET() {
  return NextResponse.json(leggiImpostazioni());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const imp = leggiImpostazioni();
  imp.ical_urls = body.ical_urls ?? imp.ical_urls;
  scriviImpostazioni(imp);
  return NextResponse.json(imp);
}
