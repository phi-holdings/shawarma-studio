import { useEffect, useMemo, useRef, useState } from 'react';
import type { InspectReport } from '@shawarma/shared';
import { inspectCode } from '../api';

export function debounceLatest<A, R>(fn: (a: A) => Promise<R>, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (a: A) => { clearTimeout(t); t = setTimeout(() => void fn(a), ms); };
}

/** Hands out sequence tokens; only the most recently issued token is current. */
export function latestGuard() {
  let n = 0;
  return { next: () => ++n, isCurrent: (t: number) => t === n };
}

export function useInspect(code: string, delayMs = 600, projectId: string | null = null) {
  const [result, setResult] = useState<{ report: InspectReport; code: string } | null>(null);
  const [offline, setOffline] = useState(false);
  const guard = useRef(latestGuard());
  const run = useMemo(
    () => debounceLatest(async (c: string) => {
      const token = guard.current.next();
      try {
        const r = await inspectCode(c, projectId);
        if (!guard.current.isCurrent(token)) return;   // a newer request superseded this one
        setResult({ report: r, code: c }); setOffline(false);
      } catch { if (guard.current.isCurrent(token)) setOffline(true); }
    }, delayMs),
    [delayMs, projectId],
  );
  useEffect(() => { run(code); }, [code, run]);
  /** `inspected`: the report together with the exact code it describes. */
  return { report: result?.report ?? null, inspected: result, offline };
}
