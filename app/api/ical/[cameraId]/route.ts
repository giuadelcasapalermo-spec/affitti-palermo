import { NextRequest, NextResponse } from 'next/server';
import { leggiPrenotazioni } from '@/lib/db';
import { CAMERE } from '@/lib/types';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function icalDate(dateStr: string): string {
  // Converti 'yyyy-MM-dd' → '20240415' (formato iCal DATE, solo data, no orario)
  return dateStr.replace(/-/g, '');
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cameraId: string }> }
) {
  const { cameraId } = await params;
  // Accetta sia /api/ical/1 che /api/ical/1.ics
  const cameraIdNum = parseInt(cameraId.replace(/\.ics$/i, ''));
  const camera = CAMERE.find((c) => c.id === cameraIdNum);

  if (!camera) {
    return new NextResponse('Camera non trovata', { status: 404 });
  }

  const prenotazioni = (await leggiPrenotazioni()).filter(
    (p) =>
      p.camera_id === cameraIdNum &&
      p.stato !== 'cancellata' &&
      p.fonte !== 'ical' &&
      !p.note?.includes('BK:') &&
      !p.note?.includes('Beds24')
  );

  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

  const eventi = prenotazioni.map((p) => {
    const uid = p.ical_uid ?? `${p.id}@affitti-palermo`;
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}Z`,
      `DTSTART;VALUE=DATE:${icalDate(p.check_in)}`,
      `DTEND;VALUE=DATE:${icalDate(p.check_out)}`,
      `SUMMARY:${escape(p.ospite_nome)}`,
      p.note ? `DESCRIPTION:${escape(p.note)}` : '',
      `STATUS:CONFIRMED`,
      'END:VEVENT',
    ]
      .filter(Boolean)
      .join('\r\n');
  });

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GiuAdel casa Palermo//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${camera.nome} - GiuAdel casa Palermo`,
    `X-WR-TIMEZONE:Europe/Rome`,
    ...eventi,
    'END:VCALENDAR',
  ].join('\r\n');

  return new NextResponse(calendar, {
    headers: {
      ...CORS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="camera-${cameraIdNum}.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
