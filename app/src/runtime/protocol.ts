// Parent <-> song runtime protocol.
//
// All Strudel evaluation runs in an iframe with sandbox="allow-scripts" (opaque origin), so song
// code cannot reach the app's API: its requests carry `Origin: null`, which the server rejects.
// Handshake: the runtime posts HELLO to its parent; the parent checks event.source/origin and
// answers CONNECT with a transferred MessagePort. Everything afterwards goes over that port.
// The parent treats every runtime message as untrusted data (song code shares the runtime realm).

import type { ChunkingOptions } from '../audio/chunks';

export const HELLO = 'shawarma-runtime:hello';
export const CONNECT = 'shawarma-runtime:connect';

/** A compiled pattern lives in the runtime; the parent only holds the code that produces it. */
export interface PatternRef { readonly code: string }

export interface ErrorInfo { message: string; line?: number; col?: number }

/** Slider widget as reported by the transpiler (positions are offsets into the evaluated code). */
export interface SliderInfo { from: number; to: number; value: string; min: number; max: number; step?: number }

/** What the parent needs of a hap to highlight it and to verify playback. */
export interface WireHap {
  begin: number;                        // whole.begin in cycles
  end: number;                          // whole.end in cycles
  locs: [number, number][];             // mini-notation source ranges (evaluated-code offsets)
  value: Record<string, string | number | boolean>; // primitive fields only (s, note, gain, color…)
}

export type Request =
  | { type: 'play'; code: string }                                    // evaluate and start
  | { type: 'playFrom'; code: string; startCycle: number }
  | { type: 'loop'; code: string; startCycle: number; cycles: number }
  | { type: 'stop' }
  | { type: 'check'; code: string }                                   // evaluatePattern: compile only, never sound
  // chunking: seam search bounds (see audio/chunks.ts); defaults to DEFAULT_CHUNKING
  | { type: 'renderRange'; code: string; cps?: number; begin: number; end: number; sampleRate: number; gainScale: number; chunking?: Partial<ChunkingOptions>; ack?: boolean }
  | { type: 'renderAck'; renderId: number; index: number; abort?: string }       // with ack: the parent took chunk `index`
  | { type: 'levels'; enabled: boolean }
  | { type: 'slider'; id: string; value: number }
  | { type: 'spin'; ms: number }                                     // isolation probe: keep the runtime busy ms (max 1000)
  | { type: 'listSounds' }                                            // the sound browser: every loaded sound
  | { type: 'audition'; name: string; n?: number }                    // one short hit of a sound (a user click)
  | { type: 'auditionStop' }                                          // cut the audition short
  | { type: 'loadSamples'; url: string; version?: string }          // a project's strudel.json (replaces the last one loaded)
  | { type: 'setOutput'; deviceId: string; label?: string };          // audio output device ('' = system default); label: fallback match

export interface Evaluated { code: string; miniLocations: [number, number][]; sliders: SliderInfo[]; cps: number }

export interface ReplyMap {
  play: Evaluated; playFrom: Evaluated; loop: Evaluated;
  stop: null;
  check: { cps: number };
  renderRange: { sampleRate: number; length: number; chunks: number; kinds: ChunkKinds; missing: string[] };
  levels: null;
  slider: null;
  renderAck: null;
  spin: null;
  listSounds: SoundInfo[];
  audition: null;
  auditionStop: null;
  loadSamples: { names: string[] };
  setOutput: null;
}

export type SoundType = 'synth' | 'sample' | 'soundfont' | 'drum-machine';
/** One entry of the sound browser (aliases of a drum bank are folded into `tags`). */
export interface SoundInfo {
  name: string;
  type: SoundType;
  /** Drum machines: the bank as written in `.bank("…")` (e.g. RolandTR808); the sound is `name` minus `<bank>_`. */
  bank?: string;
  /** Number of variants (`:0..count-1`); 1 for synths. */
  count: number;
  tags?: string[];
}

/** How many chunks of each kind a render used (normal / long / single pass). */
export interface ChunkKinds { normal: number; long: number; single: number }

export type Envelope = { id: number; req: Request };

export type RuntimeMessage =
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: ErrorInfo }
  | { type: 'renderChunk'; id: number; index: number; startSample: number; channels: Float32Array[] } // transferred
  | { type: 'ack'; nonce: string }                                  // first message on the port: the load's nonce
  | { type: 'ready' }                                               // modules + sound maps loaded
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'error'; error: ErrorInfo }                              // evaluation error (live)
  | { type: 'activeHaps'; time: number; haps: WireHap[] }
  | { type: 'levels'; peak: number[]; rms: number[] }                 // linear, per channel
  | { type: 'slider'; id: string; value: number }
  | { type: 'visuals'; height: number }                             // CSS px the visual panel needs (0: none)
  | { type: 'audioBlocked' }                                          // autoplay refused: needs a click inside the runtime
  | { type: 'audioUnlocked' }
  | { type: 'log'; level: LogLevel; message: string };               // the song's console / logger output (rate-limited in the runtime)

export type LogLevel = 'info' | 'warn' | 'error';

// ---- validation of everything the runtime sends ----
// Song code shares the runtime realm, so every field is checked here and copied into fresh objects;
// anything malformed drops the whole message (or rejects the reply).

/** Bounds a message is checked against: positions must fall inside the last evaluated code. */
export interface ParseContext { codeLength: number }

export const LIMITS = {
  haps: 256, hapLocs: 64, valueKeys: 64, keyLength: 64, stringLength: 1000, messageLength: 4000,
  codeLength: 4 * 1024 * 1024, miniLocations: 100_000, sliders: 1000, channels: 2, missing: 1000, logLength: 2000,
  sounds: 10_000, soundTags: 8, soundVariants: 100_000,
} as const;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isIdx = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max: number = LIMITS.stringLength): x is string => typeof x === 'string' && x.length <= max;
const arr = (x: unknown, max: number): x is unknown[] => Array.isArray(x) && x.length <= max;

/** [from, to] source ranges: non-negative integers, from <= to <= codeLength. */
export function parseRanges(x: unknown, codeLength: number, max: number): [number, number][] | null {
  if (!arr(x, max)) return null;
  const out: [number, number][] = [];
  for (const r of x) {
    if (!Array.isArray(r) || r.length !== 2) return null;
    const [a, b] = r;
    if (!isIdx(a) || !isIdx(b) || a > b || b > codeLength) return null;
    out.push([a, b]);
  }
  return out;
}

/** Primitive-only hap value: short string keys, short strings, finite numbers, booleans. */
export function parseHapValue(x: unknown): WireHap['value'] | null {
  if (!isObj(x)) return null;
  const keys = Object.keys(x);
  if (keys.length > LIMITS.valueKeys) return null;
  const out: WireHap['value'] = Object.create(null);
  for (const k of keys) {
    const v = x[k];
    if (!k || k.length > LIMITS.keyLength || k === '__proto__') return null;
    if (!(isStr(v) || isNum(v) || typeof v === 'boolean')) return null;
    out[k] = v;
  }
  return out;
}

export function parseHap(x: unknown, ctx: ParseContext): WireHap | null {
  if (!isObj(x) || !isNum(x.begin) || !isNum(x.end) || x.end < x.begin) return null;
  const locs = parseRanges(x.locs, ctx.codeLength, LIMITS.hapLocs);
  const value = parseHapValue(x.value);
  return locs && value ? { begin: x.begin, end: x.end, locs, value } : null;
}

export function parseErrorInfo(x: unknown): ErrorInfo | null {
  if (!isObj(x) || typeof x.message !== 'string') return null;
  // a location is only kept when it is a real 1-based position (it marks an editor line)
  const pos = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
  return {
    message: x.message.slice(0, LIMITS.messageLength),
    ...(pos(x.line) ? { line: x.line } : {}),
    ...(pos(x.line) && pos(x.col) ? { col: x.col } : {}),
  };
}

export function parseEvaluated(x: unknown): Evaluated | null {
  if (!isObj(x) || !isStr(x.code, LIMITS.codeLength) || !isNum(x.cps) || !(x.cps > 0)) return null;
  const n = x.code.length;
  const miniLocations = parseRanges(x.miniLocations, n, LIMITS.miniLocations);
  if (!miniLocations || !arr(x.sliders, LIMITS.sliders)) return null;
  const sliders: SliderInfo[] = [];
  for (const sl of x.sliders) {
    if (!isObj(sl) || !isIdx(sl.from) || !isIdx(sl.to) || sl.from > sl.to || sl.to > n) return null;
    if (!isStr(sl.value, 64) || !isNum(sl.min) || !isNum(sl.max) || !(sl.step === undefined || isNum(sl.step))) return null;
    sliders.push({ from: sl.from, to: sl.to, value: sl.value, min: sl.min, max: sl.max, ...(sl.step !== undefined ? { step: sl.step as number } : {}) });
  }
  return { code: x.code, miniLocations, sliders, cps: x.cps };
}

/** Checks a successful reply against the request it answers: `{ value }`, or null when it does not fit. */
export function parseReply<T extends Request['type']>(type: T, x: unknown): { value: ReplyMap[T] } | null {
  const ok = (v: unknown) => ({ value: v as ReplyMap[T] });
  switch (type) {
    case 'play': case 'playFrom': case 'loop': {
      const ev = parseEvaluated(x);
      return ev ? ok(ev) : null;
    }
    case 'check':
      return isObj(x) && isNum(x.cps) && x.cps > 0 ? ok({ cps: x.cps }) : null;
    case 'renderRange': {
      if (!isObj(x) || !isIdx(x.sampleRate) || !(x.sampleRate > 0) || !isIdx(x.length) || !isIdx(x.chunks)) return null;
      if (!arr(x.missing, LIMITS.missing) || !x.missing.every((m) => isStr(m, 200))) return null;
      const k = x.kinds;
      if (!isObj(k) || !isIdx(k.normal) || !isIdx(k.long) || !isIdx(k.single) || k.normal + k.long + k.single !== x.chunks) return null;
      return ok({ sampleRate: x.sampleRate, length: x.length, chunks: x.chunks, kinds: { normal: k.normal, long: k.long, single: k.single }, missing: [...x.missing] });
    }
    case 'listSounds': {
      const sounds = parseSounds(x);
      return sounds ? ok(sounds) : null;
    }
    case 'loadSamples': {
      if (!isObj(x) || !arr(x.names, LIMITS.sounds) || !x.names.every(isSoundName)) return null;
      return ok({ names: [...x.names] });
    }
    default:
      return x === null ? ok(null) : null;
  }
}

// Sound names as superdough keys them (lower-cased on registration) and banks as written in code:
// word characters plus a few separators, never anything that could break out of a string in the editor.
const SOUND_NAME = /^[\w][\w.\-#+]{0,99}$/;
const SOUND_TYPES = new Set<SoundType>(['synth', 'sample', 'soundfont', 'drum-machine']);
export const isSoundName = (x: unknown): x is string => typeof x === 'string' && SOUND_NAME.test(x);

/** The sound list: names, types, banks, counts and tags only (fresh objects), or null when any entry is off. */
export function parseSounds(x: unknown): SoundInfo[] | null {
  if (!arr(x, LIMITS.sounds)) return null;
  const out: SoundInfo[] = [];
  for (const e of x) {
    if (!isObj(e) || !isSoundName(e.name) || !SOUND_TYPES.has(e.type as SoundType)) return null;
    if (!Number.isSafeInteger(e.count) || (e.count as number) < 0 || (e.count as number) > LIMITS.soundVariants) return null;
    if (e.bank !== undefined && !isSoundName(e.bank)) return null;
    if (e.tags !== undefined && !(arr(e.tags, LIMITS.soundTags) && e.tags.every(isSoundName))) return null;
    out.push({
      name: e.name, type: e.type as SoundType, count: e.count as number,
      ...(e.bank !== undefined ? { bank: e.bank as string } : {}),
      ...(e.tags !== undefined ? { tags: [...(e.tags as string[])] } : {}),
    });
  }
  return out;
}

/** Shape check for messages arriving from the (untrusted) runtime; drops anything malformed. */
export function parseRuntimeMessage(d: unknown, ctx: ParseContext = { codeLength: 0 }): RuntimeMessage | null {
  if (!isObj(d) || typeof d.type !== 'string') return null;
  switch (d.type) {
    case 'reply': {
      if (!Number.isSafeInteger(d.id) || (d.id as number) <= 0 || typeof d.ok !== 'boolean') return null;
      if (d.ok) return { type: 'reply', id: d.id as number, ok: true, result: d.result };
      const error = parseErrorInfo(d.error);
      return error ? { type: 'reply', id: d.id as number, ok: false, error } : null;
    }
    case 'renderChunk': {
      if (!Number.isSafeInteger(d.id) || !isIdx(d.index) || !isIdx(d.startSample)) return null;
      const chs = d.channels;
      if (!Array.isArray(chs) || chs.length < 1 || chs.length > LIMITS.channels || !chs.every((c) => c instanceof Float32Array && c.length === chs[0].length)) return null;
      return { type: 'renderChunk', id: d.id as number, index: d.index, startSample: d.startSample, channels: chs as Float32Array[] };
    }
    case 'ack':
      return typeof d.nonce === 'string' && d.nonce.length <= 64 ? { type: 'ack', nonce: d.nonce } : null;
    case 'ready': case 'started': case 'stopped': case 'audioBlocked': case 'audioUnlocked':
      return { type: d.type };
    case 'error': {
      const error = parseErrorInfo(d.error);
      return error ? { type: 'error', error } : null;
    }
    case 'activeHaps': {
      if (!isNum(d.time) || !arr(d.haps, LIMITS.haps)) return null;
      const haps: WireHap[] = [];
      for (const h of d.haps) { const p = parseHap(h, ctx); if (!p) return null; haps.push(p); }
      return { type: 'activeHaps', time: d.time, haps };
    }
    case 'levels': {
      const ok = (a: unknown): a is number[] => arr(a, LIMITS.channels) && a.length > 0 && a.every((v) => isNum(v) && v >= 0);
      return ok(d.peak) && ok(d.rms) ? { type: 'levels', peak: [...d.peak], rms: [...d.rms] } : null;
    }
    case 'visuals':
      return isNum(d.height) && d.height >= 0 ? { type: 'visuals', height: Math.min(d.height, 2000) } : null;
    case 'slider':
      return isStr(d.id, 32) && /^slider_\d+$/.test(d.id) && isNum(d.value) ? { type: 'slider', id: d.id, value: d.value } : null;
    case 'log':
      return (d.level === 'info' || d.level === 'warn' || d.level === 'error') && typeof d.message === 'string'
        ? { type: 'log', level: d.level, message: d.message.slice(0, LIMITS.logLength) } : null;
    default:
      return null;
  }
}

/**
 * Highlight colour a hap may set (`.color()`), as used by @strudel/codemirror's outline: a hex colour,
 * a colour name, or rgb()/rgba() with plain numbers. Anything else (and `markcss`, which is never
 * passed on) could inject CSS into the app page's style attributes.
 */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i;
export const safeHighlightColor = (c: unknown): string | undefined => (typeof c === 'string' && SAFE_COLOR.test(c) ? c : undefined);
