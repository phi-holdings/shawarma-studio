// Parent side of the song runtime: mounts the sandboxed iframe, performs the handshake and
// exposes a typed request/event API over the private MessagePort.
import { CONNECT, HELLO, parseReply, parseRuntimeMessage, type ReplyMap, type Request, type RuntimeMessage, type WireHap } from './protocol';
import { RuntimeError } from './errors';
import { Handshake } from './handshake';
import { PACKS_PARAM, PACKS_URL_PARAM } from './packs';
import type { SoundPackSet } from '@shawarma/shared';
import { precheckCode } from '../api';
import type { ChunkingOptions } from '../audio/chunks';

/** Raised by the client itself (never parsed from the runtime): the runtime document was replaced and reloaded. */
type LocalEvent = { type: 'reloaded' };
type EventType = Exclude<RuntimeMessage['type'], 'reply' | 'renderChunk'> | LocalEvent['type'];
type EventOf<T extends EventType> = Extract<RuntimeMessage | LocalEvent, { type: T }>;
export const UNCHECKED_MESSAGE = 'This song was not run: the server could not check it first, and this browser (no site isolation, e.g. Safari) needs that check to play songs safely. Start the server and try again.';

/** Safari and every browser on iOS (all WebKit): no site isolation. */
export function isWebKitOnly(ua: string): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|Edg\/|Firefox\/|FxiOS/.test(ua);
}

export type PrecheckVerdict = { hang: boolean; error?: string; unchecked?: boolean };
export type Precheck = (code: string) => Promise<PrecheckVerdict>;
type OnChunk = (index: number, channels: Float32Array[], startSample: number) => void | Promise<void>;
type Pending = {
  type: Request['type']; resolve(v: unknown): void; reject(e: Error): void; onChunk?: OnChunk; ack?: boolean;
  /** Posted to the runtime (not waiting in the backlog), and its answer timer. */
  sent?: boolean; timer?: ReturnType<typeof setTimeout>;
};
/**
 * How long the runtime may take to answer before it counts as hung (then it is reset and reloaded):
 * play requests may wait up to 60 s for the user's "enable audio" click; a render's clock restarts with
 * every chunk it delivers (a long single-pass chunk can take minutes).
 */
export const REQUEST_TIMEOUT_MS = { default: 30_000, play: 90_000, renderChunk: 300_000 };
const timeoutFor = (t: Request['type']) => (PLAY_REQUESTS_T.has(t) ? REQUEST_TIMEOUT_MS.play : t === 'renderRange' ? REQUEST_TIMEOUT_MS.renderChunk : REQUEST_TIMEOUT_MS.default);
const PLAY_REQUESTS_T = new Set<Request['type']>(['play', 'playFrom', 'loop']);
const PLAY_REQUESTS = new Set<Request['type']>(['play', 'playFrom', 'loop']);

/** Any modal (Settings, …) open in the app: the unlock overlay never goes over one. */
const modalOpen = () => document.querySelector('.modal-backdrop, [role="dialog"], dialog[open]') !== null;

/**
 * runtime.html?n=<nonce> on the OTHER loopback hostname than the app (localhost <-> 127.0.0.1, same
 * port): a different site, so the browser's site isolation runs the runtime in its own process and a
 * song that spins forever cannot freeze the app. Other hosts keep the app's own origin.
 */
export function runtimeUrl(src: string, nonce: string, here: Location | URL = location, packs: SoundPackSet = 'all', packsUrl: string | null = null): URL {
  const url = new URL(src, here.href);
  if (here.hostname === 'localhost') url.hostname = '127.0.0.1';
  else if (here.hostname === '127.0.0.1') url.hostname = 'localhost';
  url.searchParams.set('n', nonce);
  if (packs !== 'all') url.searchParams.set(PACKS_PARAM, packs);
  if (packsUrl) url.searchParams.set(PACKS_URL_PARAM, packsUrl);
  return url;
}

/** Which sample packs the runtime loads (hosted: only cleanly licensed ones). From /api/me, before the first load. */
let soundPacks: SoundPackSet = 'all';
/** Where they are served (hosted: our own /packs/ once set up); null: Strudel's CDNs. */
let soundPacksUrl: string | null = null;
export function setSoundPacks(packs: SoundPackSet, packsUrl: string | null = null) { soundPacks = packs; soundPacksUrl = packsUrl; }

export class RuntimeClient {
  frame: HTMLIFrameElement;
  private port: MessagePort | null = null;
  /** The runtime ACKed the port with this load's nonce: requests flow only now. */
  private live = false;
  private backlog: { id: number; req: Request }[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<(m: any) => void>>();
  /** Set when the runtime never said hello: requests fail fast instead of hanging. */
  private loadError: Error | null = null;
  private readonly src: string;
  /** Nonce handshake and reload/retry policy (see handshake.ts). */
  private readonly handshake: Handshake;
  /** Length of the last evaluated code: hap/slider positions from the runtime must fall inside it. */
  private codeLength = 0;
  /** play/playFrom/loop requests in flight: only they may ask for the audio unlock. */
  private playsPending = 0;
  private unlockWanted = false;
  private unlockTimer: ReturnType<typeof setInterval> | undefined;
  /** Explanation drawn by the app around the runtime's (button-sized) unlock frame. */
  readonly unlockNote: HTMLDivElement;

  /** A fresh runtime iframe element (a reset replaces the element, which also ends a spinning document). */
  private makeFrame(): HTMLIFrameElement {
    const f = document.createElement('iframe');
    // opaque origin: no allow-same-origin, so song code can't touch the app or its API
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('allow', 'autoplay');
    f.setAttribute('title', 'Song runtime');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.className = 'runtime-frame';
    f.addEventListener('load', () => { if (f === this.frame) this.handshake.loaded(); });
    return f;
  }

  constructor(src = '/runtime.html') {
    const f = this.makeFrame();
    this.frame = f;
    this.src = src;
    this.handshake = new Handshake({
      navigate: (nonce) => {
        this.frame.setAttribute('src', runtimeUrl(this.src, nonce, location, soundPacks, soundPacksUrl).href);
      },
      connect: () => this.connect(),
      connected: () => this.connected(),
      reset: () => this.reset(),
      giveUp: (err) => {
        this.loadError = err;
        this.settleIsolation(true);          // unknown; requests fail with the load error anyway
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
        this.pending.clear();
        this.backlog = [];
      },
    });
    window.addEventListener('message', this.onWindowMessage);
    const note = document.createElement('div');
    note.className = 'unlock-note';
    note.hidden = true;
    note.setAttribute('role', 'status');
    const text = document.createElement('p');
    text.textContent = 'The browser blocked audio for the song. Click the button below to enable it.';
    note.appendChild(text);
    this.unlockNote = note;
    document.body.appendChild(note);
    document.body.appendChild(f);
    this.handshake.start();
    // the runtime asks for a click only while a play request of ours waits for audio; anything else
    // (song code can post audioBlocked at any time) is ignored
    this.on('audioBlocked', () => { if (this.playsPending > 0) this.setUnlock(true); });
    this.on('audioUnlocked', () => this.setUnlock(false));
    this.on('visuals', (m) => { this.visualsHeight = m.height; this.layout(); requestAnimationFrame(() => this.layout()); });
  }

  /**
   * The runtime document went away (or never proved itself): drop the port and every request already
   * sent; requests still in the backlog wait for the next runtime. The handshake reloads.
   */
  private reset() {
    const wasLive = this.live;
    this.live = false;
    this.port?.close();
    this.port = null;
    // a new element: the old document (maybe spinning in a loop) goes away with its frame
    const old = this.frame;
    this.frame = this.makeFrame();
    old.replaceWith(this.frame);
    for (const [id, p] of this.pending) {
      if (!p.sent) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new Error('song runtime reloaded'));
    }
    this.codeLength = 0;
    this.setUnlock(false);
    if (!wasLive) return;
    this.dispatch({ type: 'visuals', height: 0 });
    this.dispatch({ type: 'stopped' });
    this.dispatch({ type: 'reloaded' });
  }

  /** Post a request and start its answer timer (no answer in time: the runtime is reset and reloaded). */
  private send(env: { id: number; req: Request }) {
    const p = this.pending.get(env.id);
    if (!p || !this.port) return;
    p.sent = true;
    this.armTimer(env.id, p);
    this.port.postMessage(env);
  }

  private armTimer(id: number, p: Pending) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (this.pending.get(id) !== p) return;
      this.pending.delete(id);
      p.reject(new Error('The song runtime stopped answering; it was reloaded.'));
      this.handshake.unresponsive();
    }, timeoutFor(p.type));
  }

  // ---- audio unlock ----
  private setUnlock(want: boolean) {
    this.unlockWanted = want;
    clearInterval(this.unlockTimer);
    this.unlockTimer = undefined;
    if (want) this.unlockTimer = setInterval(() => this.showUnlock(), 200); // follows modals opening/closing
    this.showUnlock();
  }

  /** Unlock UI visible: wanted, and no modal open (then it waits until the modal closes). */
  private showUnlock() {
    const f = this.frame;
    const show = this.unlockWanted && !modalOpen();
    if (show === f.classList.contains('unlock')) return;
    f.classList.toggle('unlock', show);
    this.unlockNote.hidden = !show;
    if (show) { f.removeAttribute('aria-hidden'); f.tabIndex = 0; } else { f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; }
    this.layout();
  }

  // ---- visual panel ----
  // The iframe is never moved in the DOM (that would reload it and drop the song): it stays fixed in
  // <body> and is laid over the panel placeholder the app renders below the editor.
  visualsHeight = 0;
  private panel: HTMLElement | null = null;

  /** Lets the app reserve the panel's space; returns a detach function. */
  attachPanel(el: HTMLElement): () => void {
    this.panel = el;
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(el);
    ro.observe(document.body);
    const t = setInterval(() => this.layout(), 250); // also follows moves that change no size
    this.layout();
    return () => { ro.disconnect(); clearInterval(t); if (this.panel === el) this.panel = null; this.layout(); };
  }

  private layout() {
    const f = this.frame;
    if (f.classList.contains('unlock')) { f.style.left = f.style.top = f.style.width = f.style.height = ''; f.classList.remove('panel'); return; }
    // the panel may not be rendered yet (React shows it after the 'visuals' message): panel mode only
    // over a real box; the ResizeObserver / next frame lays it out once the panel has its size
    const r = this.visualsHeight > 0 && this.panel ? this.panel.getBoundingClientRect() : null;
    const show = r !== null && r.width > 0 && r.height > 0;
    f.classList.toggle('panel', show);
    if (!show || !r) { f.style.left = f.style.top = f.style.width = f.style.height = ''; return; }
    const px = (n: number) => `${n}px`;
    if (f.style.left !== px(r.left)) f.style.left = px(r.left);
    if (f.style.top !== px(r.top)) f.style.top = px(r.top);
    if (f.style.width !== px(r.width)) f.style.width = px(r.width);
    if (f.style.height !== px(r.height)) f.style.height = px(r.height);
  }

  private onWindowMessage = (e: MessageEvent) => {
    // handshake only: the runtime's own window (opaque origin => 'null'), with the nonce of the load the
    // parent started last; the nonce is used up by the first such HELLO (the runtime repeats HELLO)
    if (e.source !== this.frame.contentWindow || e.origin !== 'null' || e.data?.type !== HELLO) return;
    this.handshake.hello(e.data.nonce); // connects once the parent's own load event is in as well
  };

  /** Hand the frame's document a port; nothing is sent on it until it ACKs with this load's nonce. */
  private connect() {
    this.port?.close();
    this.live = false;
    const ch = new MessageChannel();
    ch.port1.onmessage = (m) => this.onPortMessage(ch.port1, m.data);
    this.port = ch.port1;
    this.frame.contentWindow!.postMessage({ type: CONNECT }, '*', [ch.port2]);
  }

  private connected() {
    this.live = true;
    this.loadError = null;
    for (const env of this.backlog.splice(0)) this.send(env);
    if (!this.isolationProbed) {
      this.isolationProbed = true;
      // inconclusive (the runtime was reset during the probe): probe again on the next connection
      void this.probeIsolation().then((r) => { if (r === null) this.isolationProbed = false; else this.settleIsolation(r); });
    }
  }

  // ---- site isolation ----
  // Where the runtime has no process of its own (Safari), songs only run after the server's pre-flight. WebKit has no site isolation; any other
  // browser is tested once: the runtime spins for 300 ms while this page counts its own 10 ms timer.
  private isolationProbed = false;
  private settleIsolation!: (isolated: boolean) => void;
  /** Resolves once known; until then requests carrying song code wait. */
  readonly isolation: Promise<boolean> = new Promise((resolve) => { this.settleIsolation = resolve; });

  private async probeIsolation(): Promise<boolean | null> {
    if (isWebKitOnly(navigator.userAgent)) return false;
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 10);
    try { await this.dispatchRequest({ type: 'spin', ms: 300 }, {}); }
    catch { return null; }                   // reset meanwhile: no verdict
    finally { clearInterval(iv); }
    return ticks >= 10;
  }


  private onPortMessage(port: MessagePort, data: unknown) {
    if (port !== this.port) return;
    const m = parseRuntimeMessage(data, { codeLength: this.codeLength });
    if (!m) return;
    // before the ACK the other end is unproven: only the ACK itself is looked at
    if (!this.live) { if (m.type === 'ack') this.handshake.ack(m.nonce); return; }
    if (m.type === 'ack') return;
    if (m.type === 'reply') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (!m.ok) { p.reject(new RuntimeError(m.error)); return; }
      const r = parseReply(p.type, m.result);
      if (!r) { p.reject(new Error(`the song runtime sent a malformed ${p.type} reply`)); return; }
      if (PLAY_REQUESTS.has(p.type)) this.codeLength = (r.value as ReplyMap['play']).code.length;
      p.resolve(r.value);
      return;
    }
    if (m.type === 'renderChunk') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.armTimer(m.id, p); // a render's clock restarts with every chunk
      const handled = Promise.resolve().then(() => p.onChunk?.(m.index, m.channels, m.startSample));
      // with ack the runtime renders the next chunk only once this one is taken (bounded memory);
      // a failing handler aborts the render
      if (p.ack) {
        handled.then(
          () => this.request({ type: 'renderAck', renderId: m.id, index: m.index }),
          (e) => this.request({ type: 'renderAck', renderId: m.id, index: m.index, abort: String((e as Error)?.message ?? e) }),
        );
      }
      return;
    }
    this.dispatch(m);
  }

  private dispatch(m: RuntimeMessage | LocalEvent) {
    for (const fn of this.listeners.get(m.type) ?? []) fn(m);
  }

  // ---- pre-flight: code that hangs is refused before the runtime ever evaluates it ----
  private precheck: Precheck | null = null;
  private prechecks = new Map<string, Promise<PrecheckVerdict>>();
  /** Checker for song code (the server's sandbox evaluates it with a hard timeout); null: none. */
  setPrecheck(fn: Precheck | null) { this.precheck = fn; this.prechecks.clear(); }

  private verdict(code: string): Promise<PrecheckVerdict> {
    let v = this.prechecks.get(code);
    if (!v) {
      // unreachable checker (offline): run anyway; the in-runtime loop guards still apply
      // unreachable checker: `unchecked` (fine where the runtime is isolated; refused where it is not)
      // not cached: the next run of the same code asks again (the server may have been busy)
      v = this.precheck!(code).catch(() => { this.prechecks.delete(code); return { hang: false, unchecked: true }; });
      this.prechecks.set(code, v);
      if (this.prechecks.size > 32) this.prechecks.delete(this.prechecks.keys().next().value!);
    }
    return v;
  }

  request<T extends Request>(req: T, opts: { onChunk?: OnChunk } = {}): Promise<ReplyMap[T['type']]> {
    const code = 'code' in req && typeof req.code === 'string' ? req.code : null;
    if (code === null) return this.dispatchRequest(req, opts);
    // song code runs only in a browser that isolates the runtime, and only after the pre-flight
    const reply = this.isolation.then(async (isolated) => {
      // without site isolation (Safari) the runtime shares this page's thread: songs still run, but only
      // after the server's pre-flight passed; the in-runtime loop/microtask guards stop anything later
      const v: PrecheckVerdict = this.precheck ? await this.verdict(code) : { hang: false, unchecked: true };
      if (!isolated && v.unchecked) throw new RuntimeError({ message: UNCHECKED_MESSAGE });
      if (v.hang) throw new RuntimeError({ message: `This song was not run: ${v.error ?? 'it did not finish evaluating'} (checked before playing; look for a loop that never ends).` });
      return this.dispatchRequest(req, opts);
    });
    if (!PLAY_REQUESTS.has(req.type)) return reply;
    this.playsPending++;                     // a play waiting for its check may already ask for audio
    const settled = () => { this.playsPending = Math.max(0, this.playsPending - 1); if (this.playsPending === 0) this.setUnlock(false); };
    reply.then(settled, settled);
    return reply;
  }

  private dispatchRequest<T extends Request>(req: T, opts: { onChunk?: OnChunk }): Promise<ReplyMap[T['type']]> {
    const id = this.nextId++;
    if (this.loadError && !this.live) return Promise.reject(this.loadError);
    const reply = new Promise<ReplyMap[T['type']]>((resolve, reject) => {
      this.pending.set(id, { type: req.type, resolve: resolve as (v: unknown) => void, reject, onChunk: opts.onChunk, ack: req.type === 'renderRange' && Boolean(req.ack) });
      const env = { id, req };
      if (this.live) this.send(env); else this.backlog.push(env);
    });
    return reply;   // plays are counted in request()
  }

  on<T extends EventType>(type: T, fn: (m: EventOf<T>) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
    return () => set.delete(fn);
  }
}

let instance: RuntimeClient | null = null;
export function getRuntime(): RuntimeClient {
  if (!instance) {
    instance = new RuntimeClient();
    instance.setPrecheck(precheckCode);
    if (import.meta.env.DEV) installProbe(instance);
  }
  return instance;
}

/** Dev/e2e hook: what the runtime reports (sounds heard, last haps, levels, slider echoes). */
function installProbe(rt: RuntimeClient) {
  const probe = {
    sounds: new Set<string>(),
    lastHaps: [] as WireHap[],
    hapsSeen: 0,
    /** Earliest whole.begin among reported haps since the last reset (cycles of the current run). */
    minBegin: Infinity,
    levels: { peak: [0, 0], rms: [0, 0] },
    sliders: {} as Record<string, number>,
    started: false,
    ready: false,
    reloads: 0,
    errors: [] as string[],
    reset() { this.sounds.clear(); this.hapsSeen = 0; this.lastHaps = []; this.minBegin = Infinity; },
    /** e2e: whether the runtime is process-isolated (resolves once probed). */
    isolated: () => rt.isolation,
    /** e2e: skip the server pre-flight (every song counts as checked), to exercise the in-runtime guards. */
    withoutPrecheck() { rt.setPrecheck(async () => ({ hang: false })); },
    /** e2e: the pre-flight cannot reach the server. */
    offlinePrecheck() { rt.setPrecheck(() => Promise.reject(new Error('offline'))); },
    /** e2e: shorten the answer timeouts (see REQUEST_TIMEOUT_MS). */
    timeouts: REQUEST_TIMEOUT_MS,
    request: (req: Request) => rt.request(req),
    /** Renders [begin, end) cycles and returns the joined channels (test helper; holds the whole render). */
    async render(code: string, begin: number, end: number, chunking?: Partial<ChunkingOptions>) {
      const chunks: Float32Array[][] = [];
      const r = await rt.request(
        { type: 'renderRange', code, begin, end, sampleRate: 48000, gainScale: 1, chunking, ack: true },
        { onChunk: (i, chs) => { chunks[i] = chs; } },
      );
      const join = (c: number) => { const out = new Float32Array(r.length); let o = 0; for (const ch of chunks) { out.set(ch[c], o); o += ch[c].length; } return out; };
      return { chunks: r.chunks, kinds: r.kinds, missing: r.missing, lengths: chunks.map((c) => c[0].length), channels: [join(0), join(1)] };
    },
  };
  rt.on('activeHaps', (m) => {
    if (m.haps.length) probe.lastHaps = m.haps;
    probe.hapsSeen += m.haps.length;
    for (const h of m.haps) probe.minBegin = Math.min(probe.minBegin, h.begin);
    for (const h of m.haps) if (typeof h.value.s === 'string') probe.sounds.add(h.value.s);
  });
  rt.on('levels', (m) => { probe.levels = { peak: m.peak, rms: m.rms }; });
  rt.on('slider', (m) => { probe.sliders[m.id] = m.value; });
  rt.on('ready', () => { probe.ready = true; });
  rt.on('error', (m) => { probe.errors.push(m.error.message); });
  rt.on('reloaded', () => { probe.reloads++; });
  rt.on('started', () => { probe.started = true; });
  rt.on('stopped', () => { probe.started = false; });
  (window as any).__runtime = probe;
}
