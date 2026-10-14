// Strudel engine inside the sandboxed runtime iframe: live playback, compile-only evaluation,
// chunked offline rendering, level metering and active-hap reporting.
import { repl, setPattern as exposeSchedulerPattern, setTime } from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { sliderValues } from '@strudel/codemirror';
import {
  connectToDestination, getAudioContext, getLoadedBuffer, getSampleInfo, getSound, getSuperdoughAudioController, loadBuffer, initAudio, resetGlobalEffects,
  samples, setAudioContext, setSuperdoughAudioController, soundMap, superdough, webaudioOutput,
} from '@strudel/webaudio';
import { SuperdoughAudioController } from 'superdough/superdoughoutput.mjs';
// The controller class is only available from superdough's source modules (the dist does not export it),
// and those modules have their own audio-context holder: the orbit effect sends (reverb, delay) create
// their gain nodes from it. It must point at the same context as the dist's, or every hap with
// .room()/.delay() fails to connect in an offline render.
import { setAudioContext as setSourceAudioContext } from 'superdough/audioContext.mjs';
import { createLoopGuard, fromProgram, guardLoops, loopProgram, type LoopGuardError } from '@shawarma/shared';
import { installRealmGuards } from './guardRealm';
import { LIVE_AUDIO_OPTIONS, loadModules, prebake } from '../strudel/setup';
import { DEFAULT_CHUNKING, onsetHaps, planChunks, prerollSamples } from '../audio/chunks';
import { scanWithSamples, type SampleDeps } from '../audio/sampleSlice';
import { playHaps } from '../audio/missing';
import { toErrorInfo } from './errors';
import { createVisuals } from './visuals';
import { soundCatalog, isPitched } from '../sounds/catalog';
import { projectSampleMap, sampleMapUrlOk } from '../sounds/projectSamples';
import { installSongLog } from './songLog';
import type { ErrorInfo, Evaluated, Request, RuntimeMessage, SliderInfo, WireHap } from './protocol';

type Emit = (m: RuntimeMessage, transfer?: Transferable[]) => void;

export class EngineError extends Error {
  constructor(readonly info: ErrorInfo) { super(info.message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// superdough pools some nodes (filters, compressors, supersaw/wavetable sources) in a module-level
// pool that is not keyed by AudioContext, so after switching between the live and offline contexts
// a node from the other (possibly closed) context could be reused and fail to connect. The pool
// holds WeakRefs: make stale nodes look collected so the pool builds a fresh one instead.
let currentContext: BaseAudioContext | null = null;
const deref = WeakRef.prototype.deref;
WeakRef.prototype.deref = function (this: WeakRef<object>) {
  const v = deref.call(this);
  if (v instanceof AudioNode && currentContext && v.context !== currentContext) return undefined;
  return v;
};
const liveContext = () => { const c = getAudioContext(); currentContext = c; return c as AudioContext; };

// Reverb impulse responses: superdough fills them with Math.random() noise, so every render (and
// every chunk's context) would get a different room, and the lowpassed IR arrives asynchronously,
// possibly after an offline render has started. Here the noise is seeded by the room parameters
// (same room, same IR, in every context) and renders wait until every IR has arrived.
let pendingIRs = 0;
const bufferProp = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer')!;
Object.defineProperty(ConvolverNode.prototype, 'buffer', {
  configurable: true,
  get() { return bufferProp.get!.call(this); },
  set(v: AudioBuffer | null) { bufferProp.set!.call(this, v); if (pendingIRs > 0) pendingIRs--; },
});
/** Math.random replaced by a PRNG seeded from `key` (FNV-1a + mulberry32). Returns the restore function. */
function seedRandom(key: string): () => void {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  const random = Math.random;
  Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { Math.random = random; };
}
function seeded<T>(params: unknown[], fn: () => T): T {
  const restore = seedRandom(JSON.stringify(params.map((p) => (typeof p === 'object' ? null : p))));
  try { return fn(); } finally { restore(); }
}
const reverbProto = BaseAudioContext.prototype as unknown as { createReverb(...a: unknown[]): ConvolverNode & { generate(...a: unknown[]): void } };
const createReverb = reverbProto.createReverb;
reverbProto.createReverb = function (this: BaseAudioContext, ...args: unknown[]) {
  pendingIRs++;
  const node = seeded(args, () => createReverb.apply(this, args));
  const generate = node.generate;
  node.generate = (...g: unknown[]) => { pendingIRs++; seeded(g, () => generate(...g)); };
  return node;
};
/**
 * Worklet processors draw random numbers too (supersaw/wavetable voice phases, on a voice's first
 * block). In offline renders Math.random in the worklet scope is a hash of the absolute frame (from the
 * render's start) and the draw's index within that block, so a voice gets the same phases in a chunk's
 * context as in a single pass.
 */
const RENDER_QUANTUM = 128;
function seededWorkletRandom(offsetFrames: number): string {
  const code = `const OFFSET = ${offsetFrames};
let frame = -1, k = 0;
Math.random = () => {
  if (currentFrame !== frame) { frame = currentFrame; k = 0; }
  let a = (Math.imul((currentFrame + OFFSET) | 0, 0x9e3779b1) ^ Math.imul(++k, 0x85ebca77)) | 0;
  a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};`;
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
}

const sampleDeps: SampleDeps = { getSound, getSampleInfo, getLoadedBuffer, loadBuffer: (url, label) => loadBuffer(url, getAudioContext(), label) };

async function irsReady(timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (pendingIRs > 0 && Date.now() < until) await sleep(5);
  if (pendingIRs > 0) throw new Error('reverb impulse responses were not ready in time');
}


export function createEngine(emit: Emit, ui: { showUnlock(onClick: () => Promise<boolean>): void; hideUnlock(): void; visuals: HTMLElement }) {
  const visuals = createVisuals(ui.visuals, (height) => emit({ type: 'visuals', height }));
  installSongLog(emit);
  const ready = (async () => { await loadModules(); await prebake(); })();
  /** Re-sent on every (re)connect so a late parent still learns it. */
  const announceReady = () => { void ready.then(() => { emit({ type: 'ready' }); visuals.resend(); }, () => {}); };
  let audioInitFor: BaseAudioContext | null = null;
  let started = false;

  /** Live AudioContext running with worklets loaded; asks for a click inside the runtime if autoplay is refused. */
  async function ensureAudio() {
    const ctx = liveContext();
    if (audioInitFor !== ctx) { await initAudio(LIVE_AUDIO_OPTIONS); audioInitFor = ctx; await applySink(ctx).catch(() => {}); }
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), sleep(1000)]);
    if (ctx.state === 'running') return;
    emit({ type: 'audioBlocked' });
    const unlocked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 60_000);
      ui.showUnlock(async () => {
        await ctx.resume().catch(() => {});
        if (ctx.state !== 'running') return false;
        clearTimeout(timer); resolve(true); return true;
      });
    });
    ui.hideUnlock();
    if (!unlocked) throw new Error('The browser blocked audio. Click "Enable audio" and press Play again.');
    emit({ type: 'audioUnlocked' });
  }

  // ---- audio output device (AudioContext.setSinkId; Chrome/Edge 110+) ----
  let sink: { deviceId: string; label?: string } = { deviceId: '' };
  async function applySink(ctx: AudioContext) {
    const c = ctx as AudioContext & { setSinkId?(id: string): Promise<void>; sinkId?: unknown };
    if (typeof c.setSinkId !== 'function') {
      throw new Error('This browser cannot choose an audio output for web audio (it needs AudioContext.setSinkId, in Chrome and Edge 110 or later). Pick the output in your system sound settings instead.');
    }
    if (c.sinkId === sink.deviceId) return;
    try {
      await c.setSinkId(sink.deviceId);
    } catch (e) {
      // device ids are per origin, and this frame has its own: fall back to the device with the same name
      const label = sink.label;
      const devices = label ? await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [] : [];
      const match = devices.find((d) => d.kind === 'audiooutput' && d.label === label);
      if (!match) throw new Error(`Could not switch the audio output${label ? ` to "${label}"` : ''} (${(e as Error)?.message ?? e}). Check that the device is connected, or choose the system default.`);
      await c.setSinkId(match.deviceId);
    }
  }

  // The compile-only repl is created first so the live repl's trigger/cps hooks (global in
  // @strudel/core's schedulerState) win. Compile evaluations never touch the live repl's pattern,
  // cps, hush/pPatterns or state; the few globals they do touch are restored in restoreGlobals().
  // Every loop of every evaluated song is guarded (see shared/src/loopGuard.ts): a loop that runs for
  // more than LOOP_BUDGET_MS throws, live playback stops and the error is shown, so an endless loop
  // cannot spin this thread (and, in a browser without site isolation, freeze the app). The guard is a
  // non-writable global with a random name the song cannot know when it is written.
  const LOOP_BUDGET_MS = 500;
  const guardName = `__shawarmaLoop${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  const onLoopTrip = (e: LoopGuardError) => {
    // stop after the throw unwinds (it may be inside a scheduler tick); the next tick must not loop again
    setTimeout(() => {
      if (!started) return;
      live.scheduler.stop();
      emit({ type: 'error', error: { message: e.message } });
    }, 0);
  };
  const loopGuard = createLoopGuard({ budgetMs: LOOP_BUDGET_MS, onTrip: onLoopTrip });
  Object.defineProperty(globalThis, guardName, { value: loopGuard, writable: false, configurable: false });
  // code built at runtime (eval, Function & co., string timers) is guarded too; promise chains count
  installRealmGuards(guardName, loopGuard);
  const guardedTranspiler = (code: string, options?: object) => {
    const r = transpiler(code, options);
    return { ...r, output: guardLoops(r.output, guardName) };
  };
  /**
   * Scheduler watchdog for work outside song loops (e.g. a pattern far too dense for one query): a live
   * query that took longer than SLOW_QUERY_MS stops playback with an error instead of stalling again on
   * every tick.
   */
  const SLOW_QUERY_MS = 250;
  const now = performance.now.bind(performance);
  const watchQueries = (pattern: any) => {
    if (!pattern || pattern.__watched) return;
    const query = pattern.queryArc;
    Object.defineProperty(pattern, '__watched', { value: true });
    pattern.queryArc = function (...args: unknown[]) {
      const t0 = now();
      try { return query.apply(this, args); } finally {
        const took = now() - t0;
        if (took > SLOW_QUERY_MS && started && live.scheduler.pattern === pattern) {
          setTimeout(() => {
            if (!started) return;
            live.scheduler.stop();
            emit({ type: 'error', error: { message: `One query of the song took ${Math.round(took)} ms, too long for live playback; playback was stopped.` } });
          }, 0);
        }
      }
    };
  };
  const compiler = repl({ defaultOutput: async () => {}, getTime: () => 0, transpiler: guardedTranspiler });
  const live = repl({
    defaultOutput: webaudioOutput,
    getTime: () => getAudioContext().currentTime,
    transpiler: guardedTranspiler,
    beforeEval: async () => { await ready; await ensureAudio(); visuals.beforeLiveEval(); },
    onToggle: (s: boolean) => {
      started = s;
      visuals.onToggle(s, live.scheduler);
      emit({ type: s ? 'started' : 'stopped' });
      if (s) startHapLoop(); else stopHapLoop();
    },
  });

  const restoreGlobals = () => {
    setTime(() => live.scheduler.now());
    if (live.scheduler.pattern) exposeSchedulerPattern(live.scheduler.pattern);
  };

  /** Compiles without sound. Slider values are restored by the returned `done()` (after a render). */
  async function compile(code: string) {
    await ready;
    const sliders = { ...sliderValues };
    compiler.scheduler.setCps(0.5);
    await visuals.whileCompiling(() => compiler.evaluate(code, false));
    restoreGlobals();
    const done = () => { for (const k of Object.keys(sliderValues)) delete sliderValues[k]; Object.assign(sliderValues, sliders); };
    const err = compiler.state.evalError;
    if (err) { done(); throw new EngineError(toErrorInfo(err)); }
    return { pattern: compiler.state.pattern, cps: compiler.scheduler.cps as number, done };
  }

  async function play(code: string): Promise<Evaluated> {
    await live.evaluate(code, true);
    const err = live.state.evalError;
    if (err) {
      const info = toErrorInfo(err);
      emit({ type: 'error', error: info });
      throw new EngineError(info);
    }
    watchQueries(live.scheduler.pattern);
    const widgets = (live.state.widgets ?? []) as Array<SliderInfo & { type: string; to: number }>;
    visuals.afterLiveEval(widgets, live.state.pattern, live.scheduler);
    return {
      code,
      miniLocations: (live.state.miniLocations ?? []).map(([a, b]: number[]) => [a, b] as [number, number]),
      sliders: widgets.filter((w) => w.type === 'slider').map(({ from, to, value, min, max, step }) => ({ from, to, value: String(value), min, max, step })),
      cps: live.scheduler.cps,
    };
  }

  // ---- active haps (highlighting + playback verification) ----
  let hapTimer: ReturnType<typeof setInterval> | undefined;
  let lastQuery = 0;
  const wireValue = (v: unknown): WireHap['value'] => {
    if (typeof v !== 'object' || v === null) return { value: v as string | number };
    const out: WireHap['value'] = {};
    for (const [k, x] of Object.entries(v)) if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = x;
    return out;
  };
  function startHapLoop() {
    stopHapLoop();
    lastQuery = live.scheduler.now();
    hapTimer = setInterval(() => {
      const pat = live.scheduler.pattern;
      if (!started || !pat) return;
      const t = live.scheduler.now();
      try {
        const from = Math.max(lastQuery, t - 0.1);
        lastQuery = t;
        // the scheduler starts every run at cycle 0 (playFrom/loop shift the song so the section begins
        // there) and only triggers onsets from there on: a hap that began before 0 never sounded, so it
        // is not reported (neither as an onset nor as still active)
        const haps = pat.queryArc(Math.max(0, from), t + 1e-3)
          .filter((h: any) => h.whole && h.whole.begin.valueOf() >= 0 && (h.hasOnset() || h.isActive(t)));
        emit({
          type: 'activeHaps',
          time: t,
          haps: haps.slice(0, 256).map((h: any): WireHap => ({
            begin: h.whole.begin.valueOf(),
            end: h.whole.end.valueOf(),
            locs: (h.context?.locations ?? []).map((l: { start: number; end: number }) => [l.start, l.end] as [number, number]),
            value: wireValue(h.value),
          })),
        });
      } catch { /* a query error is the song's problem; the scheduler reports it */ }
    }, 33);
  }
  function stopHapLoop() {
    clearInterval(hapTimer);
    hapTimer = undefined;
    emit({ type: 'activeHaps', time: 0, haps: [] });
  }

  // ---- level meter: master output -> splitter -> one analyser per output channel ----
  let levelsOn = false;
  let tap: { from: AudioNode; analysers: AnalyserNode[]; buf: Float32Array<ArrayBuffer> } | null = null;
  let lastPeak = 0;
  const ensureTap = () => {
    const ctx = currentContext;
    if (!ctx || ctx instanceof OfflineAudioContext || ctx.state !== 'running') return null;
    const from = getSuperdoughAudioController().output.destinationGain as AudioNode | null;
    if (!from) return null;
    if (tap?.from === from) return tap;
    // as many channels as the output really has (a muted/headless device can be mono)
    const n = Math.max(1, Math.min(2, ctx.destination.channelCount));
    const split = ctx.createChannelSplitter(n);
    from.connect(split);
    const analysers = Array.from({ length: n }, (_, ch) => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      split.connect(a, ch);
      return a;
    });
    tap = { from, analysers, buf: new Float32Array(2048) };
    return tap;
  };
  setInterval(() => {
    if (!levelsOn) return;
    const t = ensureTap();
    if (!t) return;
    const peak: number[] = [], rms: number[] = [];
    for (const a of t.analysers) {
      a.getFloatTimeDomainData(t.buf);
      let p = 0, s = 0;
      for (let i = 0; i < t.buf.length; i++) { const x = t.buf[i]; const ax = Math.abs(x); if (ax > p) p = ax; s += x * x; }
      peak.push(p); rms.push(Math.sqrt(s / t.buf.length));
    }
    const top = Math.max(...peak);
    if (!started && top === 0 && lastPeak === 0) return; // idle: nothing new to report
    lastPeak = top;
    emit({ type: 'levels', peak, rms });
  }, 50);

  // ---- offline render, chunked ----
  async function renderRange(req: Extract<Request, { type: 'renderRange' }>, onChunk: (index: number, channels: Float32Array[], startSample: number) => Promise<void>) {
    live.scheduler.stop(); // live haps must not leak into the offline context
    const { pattern, cps: compiledCps, done } = await compile(req.code);
    const cps = req.cps ?? compiledCps;
    const sr = req.sampleRate;
    const chunking = { ...DEFAULT_CHUNKING, ...req.chunking };
    // seams where nothing older than the pre-roll cap still rings (one pass over the song's onsets)
    const { grid, sliceSec } = await scanWithSamples(pattern, req.begin, req.end, cps, chunking, sampleDeps);
    const plans = planChunks(req.begin, req.end, cps, sr, grid, chunking);
    const missing = new Set<string>();
    try {
      const liveCtx = getAudioContext();
      if (liveCtx.state !== 'closed') await liveCtx.close();
      tap = null;
      for (let k = 0; k < plans.length; k++) {
        const p = plans[k];
        // pre-roll (bounded by the seam choice): everything still ringing at the chunk start is replayed
        // the context starts on a render-quantum boundary of the single pass (128 frames), so worklet
        // voices, which start on quantum boundaries, start on the same frames in both
        const ctxStart = Math.floor((p.startSample - prerollSamples(pattern, p.c0, p.startSample, req.begin, cps, sr, chunking.maxPrerollSec, sliceSec)) / RENDER_QUANTUM) * RENDER_QUANTUM;
        const pre = p.startSample - ctxStart;
        const ctxBegin = req.begin + (ctxStart / sr) * cps; // cycle at this context's time 0
        const haps = onsetHaps(pattern, Math.max(req.begin, ctxBegin), p.c1, cps);
        const ctx = new OfflineAudioContext(2, pre + p.length, sr);
        currentContext = ctx;
        setAudioContext(ctx);
        setSourceAudioContext(ctx);
        setSuperdoughAudioController(new SuperdoughAudioController(ctx));
        await initAudio({ maxPolyphony: 1024, multiChannelOrbits: false });
        await ctx.audioWorklet.addModule(seededWorkletRandom(ctxStart));
        pendingIRs = 0;
        // randomness drawn while a hap is set up (e.g. crackle noise) is seeded by that hap, so it is the
        // same whichever context (chunk or single pass) plays it
        const play = async (v: any, t: number, d: number, c: number, hap: any) => {
          const restore = seedRandom(`${hap.whole.begin.toFraction?.() ?? hap.whole.begin.valueOf()}|${JSON.stringify(hap.value)}`);
          try { return await superdough(v, t, d, c, t); } finally { restore(); }
        };
        for (const m of await playHaps(haps, play, ctxBegin, cps, req.gainScale)) missing.add(m);
        await irsReady();
        const buf = await ctx.startRendering();
        resetGlobalEffects();
        // keep only the chunk itself (copies, so the context's buffer can go)
        await onChunk(k, [buf.getChannelData(0).slice(pre), buf.getChannelData(1).slice(pre)], p.startSample);
      }
    } finally {
      done();
      setAudioContext(null);
      setSourceAudioContext(null);
      setSuperdoughAudioController(null);
      resetGlobalEffects();
      try { const ctx = liveContext(); await initAudio(LIVE_AUDIO_OPTIONS); audioInitFor = ctx; if (sink.deviceId) await applySink(ctx).catch(() => {}); }
      catch (e) { console.warn('could not restore live audio after render', e); }
    }
    const kinds = { normal: 0, long: 0, single: 0 };
    for (const p of plans) kinds[p.kind]++;
    return { sampleRate: sr, length: plans.reduce((n, p) => n + p.length, 0), chunks: plans.length, kinds, missing: [...missing] };
  }

  // ---- sound browser: list, audition, the project's own samples ----
  let rendering = 0;
  /** Waits for the built-in sounds; a request must not sit behind a slow CDN until the parent's timeout resets the runtime. */
  const soundsReady = () => Promise.race([
    ready,
    sleep(15_000).then(() => { throw new EngineError({ message: 'The song runtime is still loading its sounds. Try again in a moment.' }); }),
  ]);
  type Voice = { node?: AudioNode; stop?(t: number): void };
  let voice: Voice | undefined;
  function stopAudition() {
    const v = voice;
    voice = undefined;
    if (!v) return;
    try { v.stop?.(getAudioContext().currentTime + 0.01); } catch { /* already ended */ }
    setTimeout(() => { try { v.node?.disconnect(); } catch { /* gone */ } }, 120);
  }
  async function audition(name: string, n = 0) {
    if (rendering) throw new EngineError({ message: 'An export is rendering. Wait for it to finish, then try again.' });
    await soundsReady();
    const sound = getSound(name) as { onTrigger(t: number, v: object, onended: () => void, cps?: number): Promise<Voice | undefined>; data?: Record<string, unknown> } | undefined;
    if (!sound) throw new EngineError({ message: `No sound called "${name}" is loaded. Refresh the sound list.` });
    // no unlock overlay here (that is for Play): an audition only sounds once the browser allows audio
    const ctx = liveContext();
    if (audioInitFor !== ctx) { await initAudio(LIVE_AUDIO_OPTIONS); audioInitFor = ctx; }
    if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), sleep(500)]);
    if (ctx.state !== 'running') throw new EngineError({ message: 'The browser has not allowed sound yet. Press Play once, then try again.' });
    stopAudition();
    const params = { s: name, n: Math.max(0, Math.floor(n)), clip: 1, sustain: 1, release: 0.3, duration: 0.5, ...(isPitched(sound.data) ? { note: 48 } : {}) };
    // a sample loads on its first trigger; a trigger whose time passed while loading is dropped, so retry
    for (let attempt = 0; attempt < 10; attempt++) {
      let ref: Voice | undefined;
      ref = await sound.onTrigger(ctx.currentTime + 0.05, params, () => { try { ref?.node?.disconnect(); } catch { /* gone */ } }, 0.5);
      if (ref?.node) { connectToDestination(ref.node); voice = ref; return null; }
      await sleep(150);
    }
    throw new EngineError({ message: `"${name}" did not load in time. Check your connection and try again.` });
  }
  /** The last project's sounds (and the built-in entries they had replaced), undone on the next load. */
  let projectSounds: { names: string[]; replaced: Record<string, unknown> } = { names: [], replaced: {} };
  async function loadProjectSamples(url: string, version?: string) {
    await soundsReady();
    const next: Record<string, unknown> = { ...soundMap.get() };
    for (const k of projectSounds.names) { if (k in projectSounds.replaced) next[k] = projectSounds.replaced[k]; else delete next[k]; }
    soundMap.set(next);
    projectSounds = { names: [], replaced: {} };
    if (!url) return { names: [] };
    if (!sampleMapUrlOk(url)) throw new EngineError({ message: 'Project samples can only come from the local Shawarma server.' });
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) throw new EngineError({ message: `Could not load this project's samples (${res ? `HTTP ${res.status}` : 'the server is not reachable'}).` });
    const map = projectSampleMap(await res.json().catch(() => null), version);
    const current = soundMap.get() as Record<string, unknown>;
    const replaced: Record<string, unknown> = {};
    for (const k of Object.keys(map)) if (current[k]) replaced[k] = current[k];
    await samples(map, new URL('./', url).href, { tag: 'project' });
    projectSounds = { names: Object.keys(map), replaced };
    return { names: projectSounds.names };
  }

  // chunk acknowledgements from the parent (back-pressure: one chunk in flight)
  const acks = new Map<string, { resolve(): void; reject(e: Error): void }>();
  const waitAck = (id: number, index: number) => new Promise<void>((resolve, reject) => acks.set(`${id}:${index}`, { resolve, reject }));

  return {
    announceReady,
    async handle(id: number, req: Request): Promise<unknown> {
      switch (req.type) {
        case 'play': return play(req.code);
        case 'playFrom': return play(fromProgram(req.code, req.startCycle));
        case 'loop': return play(loopProgram(req.code, req.startCycle, req.cycles));
        case 'stop': live.scheduler.stop(); return null;
        case 'check': { const { cps, done } = await compile(req.code); done(); return { cps }; }
        case 'renderRange':
          rendering++;
          stopAudition();
          return renderRange(req, async (index, channels, startSample) => {
            const acked = req.ack ? waitAck(id, index) : Promise.resolve();
            emit({ type: 'renderChunk', id, index, startSample, channels }, channels.map((c) => c.buffer));
            await acked;
          }).finally(() => { rendering--; });
        case 'renderAck': {
          const key = `${req.renderId}:${req.index}`;
          const w = acks.get(key);
          acks.delete(key);
          if (req.abort) w?.reject(new Error(req.abort)); else w?.resolve();
          return null;
        }
        case 'levels': levelsOn = req.enabled; return null;
        case 'setOutput':
          sink = { deviceId: req.deviceId, ...(req.label ? { label: req.label } : {}) };
          await applySink(liveContext());
          return null;
        case 'spin': { const t0 = performance.now(); while (performance.now() - t0 < Math.min(1000, req.ms)) { /* isolation probe */ } return null; }
        case 'listSounds': await soundsReady(); return soundCatalog(soundMap.get());
        case 'audition': return audition(req.name, req.n);
        case 'auditionStop': stopAudition(); return null;
        case 'loadSamples': return loadProjectSamples(req.url, req.version);
        case 'slider':
          if (sliderValues[req.id] !== undefined) sliderValues[req.id] = req.value;
          emit({ type: 'slider', id: req.id, value: sliderValues[req.id] ?? req.value });
          return null;
      }
    },
    /** Requests that must not wait behind a long render. */
    isImmediate: (req: Request) => req.type === 'spin' || req.type === 'stop' || req.type === 'slider' || req.type === 'levels' || req.type === 'renderAck'
      // the sound browser never waits behind a long render (an audition refuses to play during one)
      || req.type === 'listSounds' || req.type === 'audition' || req.type === 'auditionStop' || req.type === 'loadSamples',
  };
}
