import { serve } from '@hono/node-server';
import { createCheckApp } from './app';
import { prewarmSandbox, stopSandbox } from './sandbox';

const port = Number(process.env.CHECK_PORT || 8792);
const key = process.env.CHECK_KEY?.trim();
const server = serve({ fetch: createCheckApp({ key }).fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`check-service on http://127.0.0.1:${port}${key ? ' (key required)' : ''}`);
  prewarmSandbox();
});
const stop = () => { stopSandbox(); server.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
