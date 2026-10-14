import { useEffect, useRef, type ReactNode } from 'react';

export interface WorkTab { id: string; label: string; content: ReactNode; badge?: ReactNode }

/**
 * The right column (Claude's artifact panel): tabs for the code and its tools. Every tab stays
 * mounted (the editor keeps its state and the runtime keeps playing); only the active one shows.
 */
export function WorkPanel(props: { tabs: WorkTab[]; active: string; onActive(id: string): void; tools?: ReactNode }) {
  return (
    <section className="work" aria-label="Song">
      <div className="work-head">
        <div className="tabs" role="tablist" aria-label="Song panels">
          {props.tabs.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={t.id === props.active} aria-controls={`panel-${t.id}`}
              className={`tab${t.id === props.active ? ' active' : ''}`} onClick={() => props.onActive(t.id)}>
              {t.label}{t.badge}
            </button>
          ))}
        </div>
        <div className="work-tools">{props.tools}</div>
      </div>
      {props.tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} className="work-body" hidden={t.id !== props.active}>
          {t.content}
        </div>
      ))}
    </section>
  );
}

/** A vertical drag handle that resizes the column after it (width kept in localStorage). */
export function Splitter(props: { width: number; min: number; max: number; onWidth(w: number): void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!start.current) return;
      const w = Math.min(props.max, Math.max(props.min, start.current.w - (e.clientX - start.current.x)));
      props.onWidth(w);
    };
    const up = () => { start.current = null; document.body.classList.remove('resizing'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [props.min, props.max, props.onWidth]);
  return (
    <div className="splitter" role="separator" aria-orientation="vertical" aria-label="Resize the song panel" tabIndex={0}
      aria-valuenow={Math.round(props.width)} aria-valuemin={props.min} aria-valuemax={props.max}
      onPointerDown={(e) => { start.current = { x: e.clientX, w: props.width }; document.body.classList.add('resizing'); e.preventDefault(); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') props.onWidth(Math.min(props.max, props.width + 32));
        if (e.key === 'ArrowRight') props.onWidth(Math.max(props.min, props.width - 32));
      }} />
  );
}

/** A horizontal drag handle between the code and the sounds under it (the sounds' share kept by the caller). */
export function RowSplitter(props: { share: number; onShare(share: number): void }) {
  const drag = useRef<{ y: number; share: number; height: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      props.onShare(Math.min(0.8, Math.max(0.2, d.share - (e.clientY - d.y) / d.height)));
    };
    const up = () => { drag.current = null; document.body.classList.remove('resizing-rows'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [props.onShare]);
  return (
    <div className="row-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize the sounds under the code" tabIndex={0}
      aria-valuenow={Math.round(props.share * 100)} aria-valuemin={20} aria-valuemax={80}
      onPointerDown={(e) => {
        const box = e.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = { y: e.clientY, share: props.share, height: box.height };
        document.body.classList.add('resizing-rows');
        e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') props.onShare(Math.min(0.8, props.share + 0.05));
        if (e.key === 'ArrowDown') props.onShare(Math.max(0.2, props.share - 0.05));
      }} />
  );
}
