import { serve } from '@hono/node-server';
import { createCheckApp } from './app';
import { prewarmSandbox, stopSandbox } from './sandbox';

const port = Number(process.env.CHECK_PORT || 8792);
const key = process.env.CHECK_KEY?.trim();
// loopback by default; a container next to the server sets CHECK_HOST=0.0.0.0 (and should set CHECK_KEY)
const hostname = process.env.CHECK_HOST?.trim() || '127.0.0.1';
if (hostname !== '127.0.0.1' && !key) console.warn('check-service: CHECK_HOST is not loopback and CHECK_KEY is not set; anyone who can reach this port can run song checks');
const server = serve({ fetch: createCheckApp({ key }).fetch, port, hostname }, () => {
  console.log(`check-service on http://${hostname}:${port}${key ? ' (key required)' : ''}`);
  prewarmSandbox();
});
const stop = () => { stopSandbox(); server.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
