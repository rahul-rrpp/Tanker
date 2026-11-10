/**
 * Starts a throwaway PostgreSQL (embedded-postgres) for the test run, applies migrations and seeds RBAC.
 * Set TEST_DATABASE_URL to use an existing database instead (e.g. in CI with a Postgres service).
 */
import { execSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_DB_PORT } from './setupEnv';

let pg: { stop(): Promise<void> } | null = null;

export async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    // A fresh directory per run: a crashed earlier run cannot block initialisation (Windows file locks).
    const root = join(__dirname, '..');
    for (const d of readdirSync(root).filter((n) => n.startsWith('.pgdata-test'))) {
      try {
        rmSync(join(root, d), { recursive: true, force: true });
      } catch {
        /* still locked by a stale process; left for a later run */
      }
    }
    const dir = join(root, `.pgdata-test-${Date.now()}`);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: 'ttms', password: 'ttms', port: TEST_DB_PORT, persistent: false, onLog: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase('ttms_test');
    pg = server;
    url = `postgresql://ttms:ttms@localhost:${TEST_DB_PORT}/ttms_test?schema=public`;
  }
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });
}

export async function teardown() {
  if (pg) await pg.stop();
}
