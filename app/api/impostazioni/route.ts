import { NextRequest, NextResponse } from 'next/server';
import { leggiImpostazioni, scriviImpostazioni } from '@/lib/ical';

export async function GET() {
  return NextResponse.json(await leggiImpostazioni());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const imp = await leggiImpostazioni();
  imp.ical_urls = body.ical_urls ?? imp.ical_urls;
  await scriviImpostazioni(imp);
  return NextResponse.json(imp);
}
