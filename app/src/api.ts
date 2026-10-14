import type { AnalysisReport, ChatEvent, Decision, InspectReport, ProjectSummary, Proposal, Range, VersionMeta } from '@shawarma/shared';

export class OfflineError extends Error {
  constructor(message = 'offline') { super(message); this.name = 'OfflineError'; }
}

/** fetch that maps network failures to OfflineError. */
const doFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  try { return await fetch(url, init); } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new OfflineError();
  }
};

/** An error from the server with its machine-readable `code` (hosted: allowance, project_limit, ...). */
export class ServerError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly canUpgrade = false) { super(message); this.name = 'ServerError'; }
}

/** Fired on window when the session ended (a 401 from the API in hosted mode); Root shows the landing page. */
export const SIGNED_OUT_EVENT = 'shawarma:signed-out';

/** Turns a non-OK response into OfflineError (empty 5xx gateway-style) or Error carrying the server's {error} text. */
export async function failure(res: Response): Promise<Error> {
  const text = await res.text().catch(() => '');
  let msg = '';
  let code: string | undefined;
  let canUpgrade = false;
  try {
    const o = JSON.parse(text);
    if (o && typeof o.error === 'string') msg = o.error;
    if (o && typeof o.code === 'string') code = o.code;
    canUpgrade = Boolean(o?.canUpgrade);
  } catch { /* not JSON */ }
  if (!msg && [500, 502, 503, 504].includes(res.status) && !text.trim()) return new OfflineError();
  if (res.status === 401 && code === 'signed_out' && typeof window !== 'undefined') window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  return new ServerError(msg || text.trim() || `request failed (${res.status})`, res.status, code, canUpgrade);
}

/** Plan and allowance (mirrors server/src/billing/routes.ts BillingStatus). */
export interface MeBilling {
  plan: 'free' | 'pro'; status: string; ok: boolean; usedPercent: number; resetsAt: string; canUpgrade: boolean;
  message?: string; cancelAtPeriodEnd: boolean; periodEnd: string | null;
}
/** GET /api/me: who is signed in; hosted mode adds the plan and allowance. */
export type Me =
  | { mode: 'local'; user: { id: string; email: string; name: string | null; avatarUrl: string | null } }
  | { mode: 'hosted'; user: { id: string; email: string; name: string | null; avatarUrl: string | null }; plan: 'free' | 'pro'; billing: MeBilling; limits: { maxProjects: number; thinkDeeper: boolean } };

/** The signed-in person, or null when nobody is (hosted mode, signed out). Throws OfflineError when the server is down. */
export async function getMe(): Promise<Me | null> {
  const res = await doFetch('/api/me');
  if (res.status === 401) return null;
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<Me>;
}

/** Ends the session (hosted mode). */
export const signOut = () => doFetch('/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => undefined);

const j = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
};
const post = (url: string, body: unknown) =>
  doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** chat.jsonl as the server keeps it. Proposals stored before ids existed have none (see ChatPanel). */
export type StoredChat =
  | { role: 'user' | 'assistant'; text: string; selection?: Range | null; scope?: string }
  | ({ role: 'proposal' } & Omit<Proposal, 'id'> & { id?: string })
  | ({ role: 'decision' } & Decision);

/** A save based on a version that is no longer the project's newest (HTTP 409 from PUT or /accept). */
export class StaleVersionError extends Error {
  constructor() {
    super('Not saved: this project was saved from another tab or window since you opened it. Your code is still in the editor. Copy anything you want to keep, then reload the page to get the newest version.');
    this.name = 'StaleVersionError';
  }
}

// The newest version this page knows per project: sent as baseVersionId with every save, so the server
// can refuse a save that would silently overwrite newer work from elsewhere. Set when the chat loads the
// open project (trackHead) and after each save from this page; other reads (history, share) leave it.
const heads = new Map<string, string | null>();
export const knownHead = (id: string) => heads.get(id);
export const trackHead = (id: string, versions: VersionMeta[]) => { heads.set(id, versions.at(-1)?.id ?? null); };
const track = <T extends VersionMeta>(id: string) => async (res: Response): Promise<T> => {
  if (res.status === 409) {
    const body = await res.clone().json().catch(() => null);
    if (body?.stale) throw new StaleVersionError();
  }
  const v = await j<T>(res);
  heads.set(id, v.id);
  return v;
};

/** Server settings. The API key itself is never sent back, only its last four characters. */
export type AppSettings = { hasKey: boolean; keyHint: string | null; dailyCapUsd: number; spentTodayUsd: number; fakeAi: boolean; mode?: 'local' | 'hosted' };
const put = (url: string, body: unknown) =>
  doFetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const getSettings = () => doFetch('/api/settings').then(j<AppSettings>);
/** Verifies and stores the key on the server (macOS Keychain). Throws the server's message if it is refused. */
export const saveApiKey = (key: string) => put('/api/settings/key', { key }).then(j<AppSettings>);
export const removeApiKey = () => doFetch('/api/settings/key', { method: 'DELETE' }).then(j<AppSettings>);
export const setDailyCap = (dailyCapUsd: number) => put('/api/settings', { dailyCapUsd }).then(j<AppSettings>);
/** Chat can run when a key is stored, or when the server uses the scripted fake model. */
export const chatReady = (s: AppSettings | null) => Boolean(s && (s.hasKey || s.fakeAi));

export const listProjects = () => doFetch('/api/projects').then(j<ProjectSummary[]>);
export const createProject = (name: string, code?: string) => post('/api/projects', { name, code }).then(j<ProjectSummary>);
/** Change a project's display name; its id/folder stay the same. */
export const renameProject = (id: string, name: string) =>
  doFetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then(j<ProjectSummary>);
type ProjectData = { code: string; versions: VersionMeta[]; chat: StoredChat[] };
export const getProject = (id: string) => doFetch(`/api/projects/${id}`).then(j<ProjectData>);
const base = (id: string) => (heads.has(id) ? { baseVersionId: heads.get(id) } : {});
/** Saves a manual version. Throws StaleVersionError when the project was saved elsewhere meanwhile. */
export const saveProject = (id: string, code: string, message?: string) =>
  put(`/api/projects/${id}`, { code, message, ...base(id) }).then(track<VersionMeta>(id));
/** Saves Claude's change as an 'ai' version and records the decision on the proposal (when given). */
export const acceptProposal = (id: string, a: { code: string; message: string; proposalId?: string; accepted?: number; total?: number }) =>
  post(`/api/projects/${id}/accept`, { ...a, ...base(id) }).then(track<VersionMeta & { previousVersionId: string | null }>(id));
/** Records a rejected (or later reverted) proposal in the chat, so a reload shows it and Claude is told. */
export const recordDecision = (id: string, d: { proposalId: string; status: 'rejected' | 'reverted'; reason?: string; versionId?: string }) =>
  post(`/api/projects/${id}/decisions`, d).then(j<{ role: 'decision' } & Decision>);
/** Asks the running chat turn to stop; it still sends the edits made so far as a partial proposal. */
export const stopChat = (id: string) => post(`/api/projects/${id}/chat/stop`, {}).then(j<{ stopped: boolean }>);
export const getVersion = (id: string, vid: string) => doFetch(`/api/projects/${id}/versions/${vid}`).then(j<{ code: string }>);
export const inspectCode = (code: string, projectId?: string | null) => post('/api/inspect', projectId ? { code, projectId } : { code }).then(j<InspectReport>);
/** Server pre-flight before a song runs in the page: `hang` when it never finished (see /api/precheck). */
export const precheckCode = (code: string) => post('/api/precheck', { code }).then(j<{ ok: boolean; hang?: boolean; error?: string }>)
  .then((r) => ({ hang: Boolean(r.hang), ...(r.error ? { error: r.error } : {}) }));
/** Sends a browser-side analysis back to the waiting chat turn; throws the server's {error} on non-OK. */
export const postAnalysis = (requestId: string, body: AnalysisReport | { error: string }) =>
  post(`/api/analysis/${requestId}`, body).then(j<{ ok: boolean }>);
export interface ExportResult {
  wav: string;
  mp3: string;
  /** Peak of the written WAV (the server normalises to -1 dBFS; floor for silence). */
  peakDb: number;
  small?: { path: string; kbps: number; channels: 1 | 2; bytes: number; fits: boolean; note?: string };
  /** Set by exportSong when a continuous sound forced long single-piece renders (more memory). */
  longRender?: boolean;
}

/** Bytes per upload request; the server caps one chunk at 64 MB. */
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

const littleEndian = new Uint8Array(new Float32Array([1]).buffer)[3] === 0x3f;

/** Interleaves channels into little-endian float32 PCM bytes. */
export function interleaveF32(chs: Float32Array[]): Uint8Array {
  if (!littleEndian) throw new Error('big-endian platforms are not supported for export');
  const n = chs[0]?.length ?? 0, nc = chs.length;
  const out = new Float32Array(n * nc);
  for (let c = 0; c < nc; c++) { const ch = chs[c]; for (let i = 0; i < n; i++) out[i * nc + c] = ch[i]; }
  return new Uint8Array(out.buffer);
}

/**
 * Export upload as raw float32 PCM, chunk by chunk as the render produces it. `start` gets a fresh
 * upload id from the server (its own temp file, so concurrent exports never collide), then
 * offset-checked PUTs of at most ~16 MB follow. The server tracks the peak while writing; `finish`
 * has it write the normalised (-1 dBFS) 24-bit WAV + MP3 (+ small copy). Nothing song-sized is kept
 * in the browser.
 */
export async function startExportUpload(id: string, name?: string) {
  const base = `/api/projects/${encodeURIComponent(id)}/exports`;
  // without a name the server derives a safe one from the project (any folder name works)
  const { uploadId } = await post(`${base}/start`, name === undefined ? {} : { name }).then(j<{ uploadId: string }>);
  const target = `${base}/${encodeURIComponent(uploadId)}`;
  let offset = 0;
  const put = async (bytes: Uint8Array) => {
    const res = await doFetch(`${target}/f32?offset=${offset}`, {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes as BlobPart as BodyInit,
    });
    const { size } = await j<{ size: number }>(res);
    if (size !== offset + bytes.length) throw new Error(`upload out of sync at byte ${size}`);
    offset = size;
  };
  return {
    uploadId,
    async push(chs: Float32Array[]) {
      const bytes = interleaveF32(chs);
      const step = UPLOAD_CHUNK_BYTES - (UPLOAD_CHUNK_BYTES % (4 * chs.length));
      for (let i = 0; i < bytes.length; i += step) await put(bytes.subarray(i, Math.min(bytes.length, i + step)));
    },
    finish(o: { sampleRate: number; channels: number; small?: boolean }): Promise<ExportResult> {
      return post(`${target}/finish`, { format: 'f32', sampleRate: o.sampleRate, channels: o.channels, small: Boolean(o.small) }).then(j<ExportResult>);
    },
    /** Drops a partial upload (render failed or reported missing sounds). */
    abort: () => doFetch(target, { method: 'DELETE' }).then(() => undefined, () => undefined),
  };
}

export async function streamChat(
  id: string,
  body: { code: string; selection: Range | null; message: string; deep: boolean; scope?: string },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const res = await doFetch(`/api/projects/${id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await failure(res);
  if (!res.body) throw new Error('no stream');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (!signal?.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)));
  }
}

// ---- project samples (<project folder>/samples/<folder>/<file> in the server file store) ----
export interface ProjectSamples {
  folders: { name: string; files: { name: string; size: number }[] }[];
  /** The generated strudel.json as the song runtime fetches it (local server, tokenised path). */
  mapUrl: string;
  /** Changes whenever a file does (cache-busts the runtime's sample buffers). */
  version: string;
  limits: { maxBytes: number; maxFiles: number; extensions: string[] };
}
const samplesBase = (id: string) => `/api/projects/${encodeURIComponent(id)}/samples`;
export const listSamples = (id: string) => doFetch(samplesBase(id)).then(j<ProjectSamples>);
/** Uploads one audio file into `folder` (the server makes both names safe and checks type and size). */
export const uploadSample = (id: string, folder: string, file: Blob, name: string) =>
  doFetch(`${samplesBase(id)}/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`, {
    method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' },
  }).then(j<ProjectSamples & { added: { folder: string; file: string } }>);
export const deleteSample = (id: string, folder: string, file?: string) =>
  doFetch(`${samplesBase(id)}/${encodeURIComponent(folder)}${file ? `/${encodeURIComponent(file)}` : ''}`, { method: 'DELETE' }).then(j<ProjectSamples>);
