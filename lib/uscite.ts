import { Uscita } from './types';
import sql from './postgres';

export async function leggiUscite(): Promise<Uscita[]> {
  const rows = await sql`
    SELECT id, data, descrizione, categoria, importo, camera_id, note, created_at
    FROM uscite
    ORDER BY data DESC
  `;
  return rows as unknown as Uscita[];
}

export async function scriviUscite(uscite: Uscita[]): Promise<void> {
  if (uscite.length === 0) {
    await sql`DELETE FROM uscite`;
    return;
  }

  const ids = uscite.map((u) => u.id);
  await sql`DELETE FROM uscite WHERE id != ALL(${ids})`;

  for (const u of uscite) {
    await sql`
      INSERT INTO uscite (id, data, descrizione, categoria, importo, camera_id, note, created_at)
      VALUES (
        ${u.id}, ${u.data}, ${u.descrizione}, ${u.categoria}, ${u.importo},
        ${u.camera_id ?? null}, ${u.note}, ${u.created_at}
      )
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data,
        descrizione = EXCLUDED.descrizione,
        categoria = EXCLUDED.categoria,
        importo = EXCLUDED.importo,
        camera_id = EXCLUDED.camera_id,
        note = EXCLUDED.note
    `;
  }
}
