import os from 'node:os';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';

// Ports, databases and temp dirs are per server port so several checkouts can run e2e side by side.
export const appPort = Number(process.env.E2E_APP_PORT ?? 5173);
export const serverPort = Number(process.env.E2E_SERVER_PORT ?? 8787);
/** A dedicated database per run (dropped and recreated, migrated by the server at startup) and file store. */
const dbUrl = (name: string) => `postgres://shawarma:shawarma@127.0.0.1:54329/${name}`;
export const dbName = `shawarma_e2e_${serverPort}`;
export const databaseUrl = dbUrl(dbName);
export const dataDir = path.join(os.tmpdir(), `shawarma-e2e-files-${serverPort}`);
export const cacheDir = path.join(os.tmpdir(), 'shawarma-e2e-cache'); // sample maps + settings, never ~/.shawarma-cache

// production build served by the API server itself (`pnpm build && pnpm start`), on its own port, database and dirs
export const checkPort = Number(process.env.E2E_CHECK_PORT ?? serverPort + 100);
export const prodPort = Number(process.env.E2E_PROD_PORT ?? serverPort + 1);
export const prodDist = path.join(os.tmpdir(), `shawarma-e2e-dist-${prodPort}`);
export const prodDbName = `shawarma_e2e_${prodPort}`;
export const prodDatabaseUrl = dbUrl(prodDbName);
export const prodDataDir = path.join(os.tmpdir(), `shawarma-e2e-prod-files-${prodPort}`);
export const prodCacheDir = path.join(os.tmpdir(), `shawarma-e2e-prod-cache-${prodPort}`);

/**
 * A project's folder in the file store (samples/, exports/). Its location (by owner and project uuid)
 * comes from the server's "Reveal in Finder" route, which opens nothing in e2e runs.
 */
export async function projectDir(request: APIRequestContext, id: string): Promise<string> {
  const r = await request.post(`/api/projects/${encodeURIComponent(id)}/reveal`, { data: {} });
  if (!r.ok()) throw new Error(`reveal ${id}: ${r.status()} ${await r.text()}`);
  return path.join(dataDir, ((await r.json()) as { path: string }).path);
}
export const exportsDir = async (request: APIRequestContext, id: string) => path.join(await projectDir(request, id), 'exports');
