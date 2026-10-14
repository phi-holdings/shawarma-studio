import { defineConfig } from '@playwright/test';
import { appPort, cacheDir, checkPort, databaseUrl, dataDir, dbName, prodCacheDir, prodDatabaseUrl, prodDataDir, prodDbName, prodDist, prodPort, serverPort } from './e2e/env';

// Each server gets its own empty database (shawarma_e2e_<port>, recreated per run and migrated by the
// server at startup) and its own temp file store; the local Postgres is started if needed.
const freshDb = (name: string) => `node ../../scripts/db-up.mjs && node ../../server/scripts/e2e-db.mjs ${name}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1, // one shared server + database
  use: {
    baseURL: `http://localhost:${appPort}`,
    // Never audible: headless only, output muted. The autoplay policy is pinned to Chrome's desktop
    // default so the sandboxed runtime has to earn its AudioContext the way it does for users.
    headless: true,
    // --site-per-process: site isolation as in desktop Chrome (Playwright's headless build turns it off),
    // so the cross-site song runtime gets its own process, as it does for users
    launchOptions: { args: ['--mute-audio', '--site-per-process', '--autoplay-policy=document-user-activation-required'] },
  },
  webServer: [
    { command: `CHECK_PORT=${checkPort} SHAWARMA_CACHE_DIR=${cacheDir} pnpm -C ../.. --filter @shawarma/check-service start`, port: checkPort, reuseExistingServer: false },
    {
      command: `${freshDb(dbName)} && rm -rf ${dataDir} ${cacheDir}/settings.json && PORT=${serverPort} SHAWARMA_APP_PORT=${appPort} CHECK_SERVICE_URL=http://127.0.0.1:${checkPort} SHAWARMA_FAKE_AI=1 SHAWARMA_SEARCH=off DATABASE_URL=${databaseUrl} SHAWARMA_DATA_DIR=${dataDir} SHAWARMA_CACHE_DIR=${cacheDir} pnpm -C ../.. --filter @shawarma/server dev`,
      port: serverPort,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `SHAWARMA_SERVER_PORT=${serverPort} pnpm -C ../.. --filter @shawarma/app dev --port ${appPort} --strictPort`,
      port: appPort,
      reuseExistingServer: false,
    },
    {
      // production: the built app (into a temp dir, studio/app/dist is left alone) served by the API server
      command: `${freshDb(prodDbName)} && rm -rf ${prodDataDir} ${prodCacheDir} && pnpm exec vite build --logLevel warn --outDir ${prodDist} --emptyOutDir && PORT=${prodPort} SHAWARMA_APP_DIST=${prodDist} CHECK_SERVICE_URL=http://127.0.0.1:${checkPort} SHAWARMA_FAKE_AI=1 SHAWARMA_SEARCH=off DATABASE_URL=${prodDatabaseUrl} SHAWARMA_DATA_DIR=${prodDataDir} SHAWARMA_CACHE_DIR=${prodCacheDir} pnpm -C ../.. --filter @shawarma/server start`,
      port: prodPort,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
