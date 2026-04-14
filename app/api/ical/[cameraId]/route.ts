import { NextRequest, NextResponse } from 'next/server';
import { leggiPrenotazioni } from '@/lib/db';
import { CAMERE } from '@/lib/types';

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
  const cameraIdNum = parseInt(cameraId);
  const camera = CAMERE.find((c) => c.id === cameraIdNum);

  if (!camera) {
    return new NextResponse('Camera non trovata', { status: 404 });
  }

  const prenotazioni = (await leggiPrenotazioni()).filter(
    (p) => p.camera_id === cameraIdNum && p.stato !== 'cancellata'
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
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="camera-${cameraIdNum}.ics"`,
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
