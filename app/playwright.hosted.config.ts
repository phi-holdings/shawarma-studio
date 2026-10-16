import { defineConfig } from '@playwright/test';
import { appPort, cacheDir, checkPort, databaseUrl, dataDir, dbName, devClient, devWebhookSecret, oidcPort, polarPort, publicUrl, serverPort } from './e2e-hosted/env';

// Hosted mode end to end (`pnpm e2e:hosted`): the fake Google and fake Polar, the server in hosted mode
// with fake AI on a fresh database, and the app. Never touches Google, Polar or Anthropic.
const freshDb = `node ../../scripts/db-up.mjs && node ../../server/scripts/e2e-db.mjs ${dbName}`;
const serverEnv = [
  'SHAWARMA_MODE=hosted', `PORT=${serverPort}`, `SHAWARMA_APP_PORT=${appPort}`, `PUBLIC_URL=${publicUrl}`,
  `CHECK_SERVICE_URL=http://127.0.0.1:${checkPort}`, 'SHAWARMA_FAKE_AI=1', 'SHAWARMA_SEARCH=off', `DATABASE_URL=${databaseUrl}`, `SHAWARMA_DATA_DIR=${dataDir}`, `SHAWARMA_CACHE_DIR=${cacheDir}`,
  'SESSION_SECRET=e2e-hosted-session-secret-0123456789abcdef',
  `GOOGLE_ISSUER=http://127.0.0.1:${oidcPort}`, `GOOGLE_CLIENT_ID=${devClient.id}`, `GOOGLE_CLIENT_SECRET=${devClient.secret}`,
  `POLAR_API_URL=http://127.0.0.1:${polarPort}`, 'POLAR_ACCESS_TOKEN=dev', 'POLAR_SERVER=sandbox', `POLAR_WEBHOOK_SECRET=${devWebhookSecret}`,
  'POLAR_PRODUCT_PRO_MONTHLY=dev_pro_monthly', 'POLAR_PRODUCT_PRO_YEARLY=dev_pro_yearly',
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
      command: `${freshDb} && rm -rf ${dataDir} && ${serverEnv} pnpm -C ../.. --filter @shawarma/server dev`,
      port: serverPort,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `SHAWARMA_SERVER_PORT=${serverPort} pnpm -C ../.. --filter @shawarma/app dev --port ${appPort} --strictPort`,
      port: appPort,
      reuseExistingServer: false,
    },
  ],
});
