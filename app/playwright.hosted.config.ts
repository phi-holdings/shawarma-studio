import { defineConfig } from '@playwright/test';
import { appPort, cacheDir, checkPort, databaseUrl, dataDir, dbName, devClient, devWebhookSecret, oidcPort, packsPort, polarPort, prodDataDir, prodDbName, prodDist, prodPort, prodUrl, publicUrl, serverPort } from './e2e-hosted/env';

// Hosted mode end to end (`pnpm e2e:hosted`): the fake Google and fake Polar, the server in hosted mode
// with fake AI on a fresh database, and the app (Vite). Also the production build served by a second
// hosted server, with the sound packs from a local stand-in (security headers, self-hosted sounds).
// Never touches Google, Polar or Anthropic.
const freshDb = (name: string) => `node ../../scripts/db-up.mjs && node ../../server/scripts/e2e-db.mjs ${name}`;
const shared = [
  'SHAWARMA_MODE=hosted', `CHECK_SERVICE_URL=http://127.0.0.1:${checkPort}`, 'SHAWARMA_FAKE_AI=1', 'SHAWARMA_SEARCH=off', `SHAWARMA_CACHE_DIR=${cacheDir}`,
  'SESSION_SECRET=e2e-hosted-session-secret-0123456789abcdef',
  `GOOGLE_ISSUER=http://127.0.0.1:${oidcPort}`, `GOOGLE_CLIENT_ID=${devClient.id}`, `GOOGLE_CLIENT_SECRET=${devClient.secret}`,
  `POLAR_API_URL=http://127.0.0.1:${polarPort}`, 'POLAR_ACCESS_TOKEN=dev', 'POLAR_SERVER=sandbox', `POLAR_WEBHOOK_SECRET=${devWebhookSecret}`,
  'POLAR_PRODUCT_PRO_MONTHLY=dev_pro_monthly', 'POLAR_PRODUCT_PRO_YEARLY=dev_pro_yearly',
];
const serverEnv = [...shared, `PORT=${serverPort}`, `SHAWARMA_APP_PORT=${appPort}`, `PUBLIC_URL=${publicUrl}`, `DATABASE_URL=${databaseUrl}`, `SHAWARMA_DATA_DIR=${dataDir}`].join(' ');
// production: the built app served by the hosted server (its security headers), sound packs self-hosted
const prodEnv = [
  ...shared, `PORT=${prodPort}`, `PUBLIC_URL=${prodUrl}`, `SHAWARMA_APP_DIST=${prodDist}`, `SHAWARMA_PACKS_URL=http://127.0.0.1:${packsPort}/packs`,
  `DATABASE_URL=postgres://shawarma:shawarma@127.0.0.1:54329/${prodDbName}`, `SHAWARMA_DATA_DIR=${prodDataDir}`,
].join(' ');

export default defineConfig({
  testDir: 'e2e-hosted',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: publicUrl,
    // never audible: headless, muted
    headless: true,
    launchOptions: { args: ['--mute-audio', '--site-per-process', '--autoplay-policy=document-user-activation-required'] },
  },
  webServer: [
    { command: `CHECK_PORT=${checkPort} SHAWARMA_CACHE_DIR=${cacheDir} SOUND_PACKS=hosted pnpm -C ../.. --filter @shawarma/check-service start`, port: checkPort, reuseExistingServer: false },
    { command: `DEV_OIDC_PORT=${oidcPort} pnpm -C ../.. --filter @shawarma/server dev:oidc`, port: oidcPort, reuseExistingServer: false },
    {
      command: `DEV_POLAR_PORT=${polarPort} DEV_POLAR_WEBHOOK_URL=http://127.0.0.1:${serverPort}/api/billing/polar/webhook POLAR_WEBHOOK_SECRET=${devWebhookSecret} pnpm -C ../.. --filter @shawarma/server dev:polar`,
      port: polarPort,
      reuseExistingServer: false,
    },
    {
      command: `${freshDb(dbName)} && rm -rf ${dataDir} && ${serverEnv} pnpm -C ../.. --filter @shawarma/server dev`,
      port: serverPort,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `SHAWARMA_SERVER_PORT=${serverPort} pnpm -C ../.. --filter @shawarma/app dev --port ${appPort} --strictPort`,
      port: appPort,
      reuseExistingServer: false,
    },
    { command: `PACKS_PORT=${packsPort} node e2e-hosted/packs-server.mjs`, port: packsPort, reuseExistingServer: false },
    {
      command: `${freshDb(prodDbName)} && rm -rf ${prodDataDir} && PUBLIC_URL=${prodUrl} pnpm exec vite build --logLevel warn --outDir ${prodDist} --emptyOutDir && ${prodEnv} pnpm -C ../.. --filter @shawarma/server start`,
      port: prodPort,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
