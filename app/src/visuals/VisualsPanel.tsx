import { useEffect, useRef, useState } from 'react';
import { getRuntime } from '../runtime/client';

/**
 * Space for the song's visuals (`._pianoroll()`, `._scope()`, `.punchcard()`…). They are drawn by the
 * sandboxed runtime iframe, which the runtime client lays over this box; it takes no pointer input.
 */
export function VisualsPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => getRuntime().visualsHeight);
  useEffect(() => {
    const rt = getRuntime();
    const off = rt.on('visuals', (m) => setHeight(m.height));
    const detach = rt.attachPanel(ref.current!);
    return () => { off(); detach(); };
  }, []);
  return <div ref={ref} className="visuals-panel" data-testid="visuals-panel" aria-label="Song visuals" style={{ height, display: height ? 'block' : 'none' }} />;
}
