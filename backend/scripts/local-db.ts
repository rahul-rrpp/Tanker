/**
 * Starts a local PostgreSQL server without Docker or a system install (development convenience).
 * Data persists in backend/.pgdata. Stop with Ctrl+C.
 *
 *   npm run db:local
 *   DATABASE_URL=postgresql://ttms:ttms@localhost:54329/ttms
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
// LOCAL_DB_DIR lets you run a second, fresh instance (e.g. if an old one is stuck on the default directory).
const dataDir = process.env.LOCAL_DB_DIR ? join(__dirname, '..', process.env.LOCAL_DB_DIR) : join(__dirname, '..', '.pgdata');

async function main() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'ttms', password: 'ttms', port: PORT, persistent: true });
  const fresh = !existsSync(join(dataDir, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase('ttms');
  console.log(`PostgreSQL running: postgresql://ttms:ttms@localhost:${PORT}/ttms  (Ctrl+C to stop)`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
