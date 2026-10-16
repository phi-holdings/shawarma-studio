// Entry of the sandboxed song runtime (runtime.html). Waits for the parent's MessagePort, then
// serves requests from it. Window messages are only used for that one handshake.
import { CONNECT, HELLO, type Envelope, type RuntimeMessage } from './protocol';
import { toErrorInfo } from './errors';
import { EngineError, createEngine } from './engine';
import { packsFromSearch, packsUrlFromSearch } from './packs';

// The app loads this page from the other loopback hostname (localhost <-> 127.0.0.1, same scheme and
// port) so it runs cross-site, in its own process; elsewhere the app shares this page's origin.
const own = new URL(location.href);
const other = own.hostname === 'localhost' ? '127.0.0.1' : own.hostname === '127.0.0.1' ? 'localhost' : own.hostname;
const parentOrigins = new Set([own.origin, `${own.protocol}//${other}${own.port ? `:${own.port}` : ''}`]);
let port: MessagePort | null = null;
const emit = (m: RuntimeMessage, transfer: Transferable[] = []) => port?.postMessage(m, transfer);

const unlock = document.getElementById('unlock') as HTMLButtonElement;
const engine = createEngine(emit, {
  showUnlock(onClick) {
    unlock.classList.add('show');
    unlock.onclick = () => { void onClick(); };
  },
  hideUnlock() { unlock.classList.remove('show'); unlock.onclick = null; },
  visuals: document.getElementById('visuals') as HTMLElement,
}, packsFromSearch(location.search), packsUrlFromSearch(location.search));

let queue: Promise<unknown> = Promise.resolve();
function serve(env: Envelope) {
  if (!env || typeof env.id !== 'number' || !env.req || typeof env.req.type !== 'string') return;
  const run = async () => {
    try {
      const result = await engine.handle(env.id, env.req);
      emit({ type: 'reply', id: env.id, ok: true, result });
    } catch (e) {
      emit({ type: 'reply', id: env.id, ok: false, error: e instanceof EngineError ? e.info : toErrorInfo(e) });
    }
  };
  if (engine.isImmediate(env.req)) void run();
  else queue = queue.then(run);
}

window.addEventListener('message', function onConnect(e: MessageEvent) {
  if (port || e.source !== window.parent || !parentOrigins.has(e.origin) || e.data?.type !== CONNECT || !e.ports[0]) return;
  window.removeEventListener('message', onConnect);
  clearInterval(helloTimer);
  port = e.ports[0];
  // prove over the port that this is the runtime loaded for this nonce (CONNECT never carries it)
  port.postMessage({ type: 'ack', nonce: nonce ?? '' } satisfies RuntimeMessage);
  port.onmessage = (m) => serve(m.data as Envelope);
  engine.announceReady();
});
// HELLO is repeated until the port arrives.
// the parent accepts HELLO only with the nonce it put in this document's URL for this load
const nonce = new URLSearchParams(location.search).get('n');
const hello = () => window.parent.postMessage({ type: HELLO, nonce }, '*');
const helloTimer = setInterval(hello, 100);
hello();
