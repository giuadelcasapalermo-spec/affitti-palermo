/**
 * Migrazione JSON → Neon Postgres
 * Esegui con: npx tsx scripts/migrate-to-db.ts
 */

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const sql = neon(process.env.DATABASE_URL!);
const DATA = path.join(process.cwd(), 'data');

async function main() {
  console.log('Connessione a Neon...');

  // ── Crea tabelle ───────────────────────────────────────────────────────────

  await sql`
    CREATE TABLE IF NOT EXISTS prenotazioni (
      id TEXT PRIMARY KEY,
      camera_id INTEGER NOT NULL,
      ospite_nome TEXT NOT NULL DEFAULT '',
      ospite_telefono TEXT NOT NULL DEFAULT '',
      ospite_email TEXT NOT NULL DEFAULT '',
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      importo_totale REAL NOT NULL DEFAULT 0,
      tassa_soggiorno REAL,
      stato TEXT NOT NULL DEFAULT 'confermata',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      fonte TEXT NOT NULL DEFAULT 'manuale',
      ical_uid TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS uscite (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      descrizione TEXT NOT NULL,
      categoria TEXT NOT NULL,
      importo REAL NOT NULL,
      camera_id INTEGER,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS entrate (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      descrizione TEXT NOT NULL,
      categoria TEXT NOT NULL,
      importo REAL NOT NULL,
      camera_id INTEGER,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS impostazioni (
      tipo TEXT NOT NULL,
      chiave TEXT NOT NULL,
      valore TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tipo, chiave)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS utenti (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL
    )
  `;

  console.log('Tabelle create.');

  // ── Prenotazioni ───────────────────────────────────────────────────────────
  const prenotazioni = JSON.parse(fs.readFileSync(path.join(DATA, 'prenotazioni.json'), 'utf-8'));
  for (const p of prenotazioni) {
    await sql`
      INSERT INTO prenotazioni (id, camera_id, ospite_nome, ospite_telefono, ospite_email,
        check_in, check_out, importo_totale, tassa_soggiorno, stato, note, created_at, fonte, ical_uid)
      VALUES (
        ${p.id}, ${p.camera_id}, ${p.ospite_nome}, ${p.ospite_telefono ?? ''}, ${p.ospite_email ?? ''},
        ${p.check_in}, ${p.check_out}, ${p.importo_totale ?? 0}, ${p.tassa_soggiorno ?? null},
        ${p.stato}, ${p.note ?? ''}, ${p.created_at}, ${p.fonte ?? 'manuale'}, ${p.ical_uid ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`Prenotazioni: ${prenotazioni.length} importate.`);

  // ── Uscite ─────────────────────────────────────────────────────────────────
  const uscite = JSON.parse(fs.readFileSync(path.join(DATA, 'uscite.json'), 'utf-8'));
  for (const u of uscite) {
    await sql`
      INSERT INTO uscite (id, data, descrizione, categoria, importo, camera_id, note, created_at)
      VALUES (
        ${u.id}, ${u.data}, ${u.descrizione}, ${u.categoria}, ${u.importo},
        ${u.camera_id ?? null}, ${u.note ?? ''}, ${u.created_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`Uscite: ${uscite.length} importate.`);

  // ── Entrate ────────────────────────────────────────────────────────────────
  const entrate = JSON.parse(fs.readFileSync(path.join(DATA, 'entrate.json'), 'utf-8'));
  for (const e of entrate) {
    await sql`
      INSERT INTO entrate (id, data, descrizione, categoria, importo, camera_id, note, created_at)
      VALUES (
        ${e.id}, ${e.data}, ${e.descrizione}, ${e.categoria}, ${e.importo},
        ${e.camera_id ?? null}, ${e.note ?? ''}, ${e.created_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`Entrate: ${entrate.length} importate.`);

  // ── Impostazioni ───────────────────────────────────────────────────────────
  const imp = JSON.parse(fs.readFileSync(path.join(DATA, 'impostazioni.json'), 'utf-8'));
  for (const [id, url] of Object.entries(imp.ical_urls ?? {})) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('ical', ${id}, ${url as string})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  for (const [id, nome] of Object.entries(imp.nomi_camere ?? {})) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('camera', ${id}, ${nome as string})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  if (imp.ultimo_sync) {
    await sql`
      INSERT INTO impostazioni (tipo, chiave, valore) VALUES ('sync', 'ultimo_sync', ${imp.ultimo_sync})
      ON CONFLICT (tipo, chiave) DO UPDATE SET valore = EXCLUDED.valore
    `;
  }
  console.log('Impostazioni importate.');

  // ── Utenti ─────────────────────────────────────────────────────────────────
  const utenti = JSON.parse(fs.readFileSync(path.join(DATA, 'utenti.json'), 'utf-8'));
  for (const u of utenti) {
    await sql`
      INSERT INTO utenti (id, username, salt, hash)
      VALUES (${u.id}, ${u.username}, ${u.salt}, ${u.hash})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`Utenti: ${utenti.length} importati.`);

  console.log('\nMigrazione completata!');
}

main().catch((err) => {
  console.error('Errore:', err);
  process.exit(1);
});
