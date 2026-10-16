// Stand-in for the self-hosted sound packs in the hosted e2e (production serves them from Caddy's /packs/,
// filled by the platform's deploy/fetch-samples.mts). Same layout, but instead of a 2.6 GB folder it fetches
// each file from Strudel's CDN (and GM soundfonts from GitHub Pages) on demand and caches it in memory.
// Sample maps get their _base rewritten to this server, like the real ones.
//   PACKS_PORT=8990 node e2e-hosted/packs-server.mjs
import http from 'node:http';

const port = Number(process.env.PACKS_PORT ?? 8990);
const SAMPLE_CDN = 'https://strudel.b-cdn.net';
const GM_CDN = 'https://felixroos.github.io/webaudiofontdata/sound';
const self = `http://127.0.0.1:${port}/packs`;
const FOLDERS = { 'piano.json': 'piano', 'vcsl.json': 'VCSL', 'uzu-drumkit.json': 'uzu-drumkit', 'mridangam.json': 'mrid' };
const TYPES = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.json': 'application/json', '.js': 'text/javascript' };
const cache = new Map();

async function load(rel) {
  const upstream = rel.startsWith('gm/') ? `${GM_CDN}/${rel.slice(3)}` : `${SAMPLE_CDN}/${rel}`;
  const res = await fetch(upstream, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return { status: res.status, body: Buffer.alloc(0) };
  let body = Buffer.from(await res.arrayBuffer());
  const folder = FOLDERS[rel];
  if (folder) {
    const map = JSON.parse(body.toString('utf8'));
    for (const [k, v] of Object.entries(map)) if (v && typeof v === 'object' && !Array.isArray(v) && '_base' in v) v._base = `${self}/${folder}/`;
    map._base = `${self}/${folder}/`;
    body = Buffer.from(JSON.stringify(map));
  }
  return { status: 200, body };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const rel = url.pathname.startsWith('/packs/') ? url.pathname.slice('/packs/'.length) : null;
  res.setHeader('access-control-allow-origin', '*');
  if (!rel || rel.includes('..')) { res.writeHead(404).end(); return; }
  try {
    let hit = cache.get(rel);
    if (!hit) { hit = load(rel); cache.set(rel, hit); }
    const { status, body } = await hit;
    if (status !== 200) cache.delete(rel);
    const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
    res.writeHead(status, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    cache.delete(rel);
    res.writeHead(502).end(String(e));
  }
}).listen(port, '127.0.0.1', () => console.log(`packs on ${self}/`));
