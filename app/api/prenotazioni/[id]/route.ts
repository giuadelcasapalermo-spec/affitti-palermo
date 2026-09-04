import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/postgres';
import { ignoraUidIcal, leggiImpostazioni } from '@/lib/ical';
import { aggiornaRigaSheetPerPrenotazione } from '@/lib/googlesheets';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`SELECT * FROM prenotazioni WHERE id = ${id}`;
  if (rows.length === 0) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const rows = await sql`
    UPDATE prenotazioni SET
      camera_id        = COALESCE(${body.camera_id        ?? null}, camera_id),
      ospite_nome      = COALESCE(${body.ospite_nome      ?? null}, ospite_nome),
      ospite_telefono  = COALESCE(${body.ospite_telefono  ?? null}, ospite_telefono),
      ospite_email     = COALESCE(${body.ospite_email     ?? null}, ospite_email),
      check_in         = COALESCE(${body.check_in         ?? null}, check_in),
      check_out        = COALESCE(${body.check_out        ?? null}, check_out),
      importo_totale   = COALESCE(${body.importo_totale   ?? null}, importo_totale),
      tassa_soggiorno  = COALESCE(${body.tassa_soggiorno  ?? null}, tassa_soggiorno),
      stato            = COALESCE(${body.stato            ?? null}, stato),
      note             = COALESCE(${body.note             ?? null}, note)
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  const pren = rows[0];

  // Se esiste già una riga corrispondente (camera+check-in) nel tab mensile del foglio
  // Google — creata alla sync iCal o inserita a mano — la teniamo allineata quando
  // l'utente modifica nome, telefono, importo o tassa dall'app. Se non c'è nessuna riga
  // corrispondente, aggiornaRigaSheetPerPrenotazione non fa nulla (nessun errore).
  try {
    const imp = await leggiImpostazioni();
    if (imp.google_sheet_id?.trim()) {
      await aggiornaRigaSheetPerPrenotazione({
        check_in: pren.check_in as string,
        camera_id: pren.camera_id as number,
        ospite_nome: pren.ospite_nome as string,
        ospite_telefono: pren.ospite_telefono as string,
        importo_lordo: pren.importo_totale as number,
        tassa_soggiorno: pren.tassa_soggiorno as number | undefined,
      });
    }
  } catch {
    // Non bloccare il salvataggio in app per un errore sul foglio
  }

  return NextResponse.json(pren);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`DELETE FROM prenotazioni WHERE id = ${id} RETURNING id, camera_id, fonte, ical_uid`;
  if (rows.length === 0) return NextResponse.json({ error: 'Non trovata' }, { status: 404 });
  const deleted = rows[0];
  if (deleted.fonte === 'ical' && deleted.ical_uid) {
    await ignoraUidIcal(deleted.ical_uid as string, deleted.camera_id as number);
  }
  return NextResponse.json({ ok: true });
}
