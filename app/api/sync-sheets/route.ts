import { NextRequest, NextResponse } from 'next/server';
import { syncToSheets, importFromSheets } from '@/lib/googlesheets';

export async function POST(req: NextRequest) {
  const { direzione } = await req.json() as { direzione: 'export' | 'import' | 'both' };

  // Diagnostica env vars
  const envCheck = {
    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
  };

  try {
    if (direzione === 'export') {
      await syncToSheets();
      return NextResponse.json({ ok: true, messaggio: 'Dati esportati su Google Sheets' });
    }

    if (direzione === 'import') {
      const { importate, ignorate, doppioniRimossi } = await importFromSheets();
      const extra = doppioniRimossi > 0 ? `, rimossi ${doppioniRimossi} doppioni Booking` : '';
      return NextResponse.json({ ok: true, messaggio: `Importati ${importate} movimenti (${ignorate} già presenti${extra})` });
    }

    if (direzione === 'both') {
      await syncToSheets();
      const { importate, doppioniRimossi } = await importFromSheets();
      const extra = doppioniRimossi > 0 ? `, rimossi ${doppioniRimossi} doppioni Booking` : '';
      return NextResponse.json({ ok: true, messaggio: `Sincronizzazione completata — importati ${importate}${extra}` });
    }

    return NextResponse.json({ ok: false, errore: 'direzione non valida' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : '';
    return NextResponse.json({ ok: false, errore: msg, stack, envCheck }, { status: 500 });
  }
}
