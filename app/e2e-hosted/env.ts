import os from 'node:os';
import path from 'node:path';

// Hosted-mode e2e: its own ports, database and dirs, so it runs next to the local-mode suite and a dev server.
export const appPort = Number(process.env.E2E_HOSTED_APP_PORT ?? 5373);
export const serverPort = Number(process.env.E2E_HOSTED_SERVER_PORT ?? 8987);
export const checkPort = Number(process.env.E2E_HOSTED_CHECK_PORT ?? serverPort + 100);
export const oidcPort = Number(process.env.E2E_HOSTED_OIDC_PORT ?? 8995);
export const polarPort = Number(process.env.E2E_HOSTED_POLAR_PORT ?? 8996);
export const publicUrl = `http://localhost:${appPort}`;
export const dbName = `shawarma_e2e_hosted_${serverPort}`;
export const databaseUrl = `postgres://shawarma:shawarma@127.0.0.1:54329/${dbName}`;
export const dataDir = path.join(os.tmpdir(), `shawarma-e2e-hosted-files-${serverPort}`);
export const cacheDir = path.join(os.tmpdir(), 'shawarma-e2e-cache');
/** The fakes' fixed local credentials (server/src/auth/devOidc.ts, server/src/billing/devPolar.ts). */
export const devClient = { id: 'shawarma-dev-client', secret: 'shawarma-dev-client-secret' };
export const devWebhookSecret = 'whsec_' + Buffer.from('shawarma-dev-polar-webhook-secret').toString('base64');
