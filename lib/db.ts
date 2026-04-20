import { Prenotazione } from './types';
import sql from './postgres';

export async function leggiPrenotazioni(): Promise<Prenotazione[]> {
  const rows = await sql`
    SELECT id, camera_id, ospite_nome, ospite_telefono, ospite_email,
           check_in, check_out, importo_totale, tassa_soggiorno,
           stato, note, created_at, fonte, ical_uid
    FROM prenotazioni
    ORDER BY check_in DESC
  `;
  return rows as unknown as Prenotazione[];
}

export async function scriviPrenotazioni(prenotazioni: Prenotazione[]): Promise<void> {
  if (prenotazioni.length === 0) {
    await sql`DELETE FROM prenotazioni`;
    return;
  }

  const ids = prenotazioni.map((p) => p.id);
  await sql`DELETE FROM prenotazioni WHERE id != ALL(${ids})`;

  for (const p of prenotazioni) {
    await sql`
      INSERT INTO prenotazioni (id, camera_id, ospite_nome, ospite_telefono, ospite_email,
        check_in, check_out, importo_totale, tassa_soggiorno, stato, note, created_at, fonte, ical_uid)
      VALUES (
        ${p.id}, ${p.camera_id}, ${p.ospite_nome}, ${p.ospite_telefono}, ${p.ospite_email},
        ${p.check_in}, ${p.check_out}, ${p.importo_totale}, ${p.tassa_soggiorno ?? null},
        ${p.stato}, ${p.note}, ${p.created_at}, ${p.fonte}, ${p.ical_uid ?? null}
      )
      ON CONFLICT (id) DO UPDATE SET
        camera_id = EXCLUDED.camera_id,
        ospite_nome = EXCLUDED.ospite_nome,
        ospite_telefono = EXCLUDED.ospite_telefono,
        ospite_email = EXCLUDED.ospite_email,
        check_in = EXCLUDED.check_in,
        check_out = EXCLUDED.check_out,
        importo_totale = EXCLUDED.importo_totale,
        tassa_soggiorno = EXCLUDED.tassa_soggiorno,
        stato = EXCLUDED.stato,
        note = EXCLUDED.note,
        fonte = EXCLUDED.fonte,
        ical_uid = EXCLUDED.ical_uid
    `;
  }
}
