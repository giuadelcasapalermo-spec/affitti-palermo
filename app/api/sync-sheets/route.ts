import { NextRequest, NextResponse } from 'next/server';
import { exportToSheets, importFromSheets } from '@/lib/googlesheets';

export async function POST(req: NextRequest) {
  const { direzione } = await req.json() as { direzione: 'export' | 'import' | 'both' };

  try {
    if (direzione === 'export') {
      await exportToSheets();
      return NextResponse.json({ ok: true, messaggio: 'Dati esportati su Google Sheets' });
    }

    if (direzione === 'import') {
      const { importate, ignorate } = await importFromSheets();
      return NextResponse.json({ ok: true, messaggio: `Importati ${importate} movimenti (${ignorate} già presenti)` });
    }

    if (direzione === 'both') {
      await exportToSheets();
      const { importate, ignorate } = await importFromSheets();
      return NextResponse.json({ ok: true, messaggio: `Sincronizzazione completata — importati ${importate}, aggiornato foglio` });
    }

    return NextResponse.json({ ok: false, errore: 'direzione non valida' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    return NextResponse.json({ ok: false, errore: msg }, { status: 500 });
  }
}
