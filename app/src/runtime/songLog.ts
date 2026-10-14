// The song's own output (console.* and Strudel's logger, which also prints to the console) forwarded
// to the app's Console tab. Runs inside the runtime: song code can log in a tight loop, so output is
// rate-limited (token bucket) and every message is size-capped before it crosses to the parent.
import type { LogLevel, RuntimeMessage } from './protocol';

export const SONG_LOG = { perSecond: 20, burst: 40, maxLength: 1000 } as const;

/** Strudel housekeeping that says nothing about the song (loading progress, start/stop, evaluations). */
const NOISE = [
  // an evaluation error reaches the app as an error already (see also installSongLog)
  /^\[eval\] (code updated|error:)/, /^\[cyclist\] (start|stop|pause)/, /^🌀/, /^\[(superdough|kabelsalat)\]:? (ready|AudioWorklets loaded)/,
  /^\[(sampler|wavetable)\] load .*\.\.(\.? done!.*)?$/, /^\[webaudio\] (preloading|start rendering|rendering cycles|finish rendering)/,
];
export const isNoise = (m: string) => NOISE.some((r) => r.test(m));

const show = (x: unknown): string => {
  if (typeof x === 'string') return x;
  if (x instanceof Error) return x.message;
  // the transpiler turns "double-quoted" strings into patterns: show what the pattern says
  if (typeof x === 'object' && x !== null && (x as { _Pattern?: unknown })._Pattern === true) {
    try {
      const values = (x as { firstCycleValues: unknown[] }).firstCycleValues;
      return values.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(' ');
    } catch { return '[pattern]'; }
  }
  if (typeof x === 'object' && x !== null) {
    try { return JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? String(v) : v)); } catch { return Object.prototype.toString.call(x); }
  }
  return String(x);
};

/** console-style arguments as one line; `%c` styling (Strudel's logger uses it) is dropped with its CSS argument. */
export function formatArgs(args: unknown[]): string {
  let rest = args;
  if (typeof args[0] === 'string' && args[0].includes('%c')) {
    const styles = args[0].split('%c').length - 1;
    rest = [args[0].replaceAll('%c', ''), ...args.slice(1 + styles)];
  }
  const s = rest.map(show).join(' ');
  return s.length > SONG_LOG.maxLength ? `${s.slice(0, SONG_LOG.maxLength)}…` : s;
}

/** Token-bucket forwarder: drops what exceeds the rate and reports how much was dropped a second later. */
export function createLogForwarder(
  emit: (m: RuntimeMessage) => void,
  now: () => number = () => performance.now(),
  later: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
) {
  let tokens: number = SONG_LOG.burst;
  let last = now();
  let dropped = 0;
  const report = () => {
    emit({ type: 'log', level: 'warn', message: `${dropped} more message${dropped === 1 ? ' was' : 's were'} dropped: the song logs faster than ${SONG_LOG.perSecond} per second.` });
    dropped = 0;
  };
  return (level: LogLevel, message: string) => {
    if (isNoise(message)) return;
    const t = now();
    tokens = Math.min(SONG_LOG.burst, tokens + ((t - last) / 1000) * SONG_LOG.perSecond);
    last = t;
    if (tokens < 1) {
      if (dropped++ === 0) later(report, 1000);
      return;
    }
    tokens--;
    emit({ type: 'log', level, message });
  };
}

/** Wraps the realm's console so the song's output also goes to the parent (the original still prints). */
export function installSongLog(emit: (m: RuntimeMessage) => void) {
  const forward = createLogForwarder(emit);
  const levels: [keyof Console, LogLevel][] = [['log', 'info'], ['info', 'info'], ['debug', 'info'], ['warn', 'warn'], ['error', 'error']];
  for (const [name, level] of levels) {
    const original = console[name] as (...a: unknown[]) => void;
    (console as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      original.apply(console, args);
      // Strudel's repl follows "[eval] error: …" with console.error(err): already shown as an error
      if (name === 'error' && args.length === 1 && args[0] instanceof Error) return;
      try { forward(level, formatArgs(args)); } catch { /* never let logging break the song */ }
    };
  }
}
