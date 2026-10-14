import { useEffect, useId, useRef, type ReactNode } from 'react';
import './projects.css';

/**
 * In-app dialog shell (same look as Settings): Escape or a click on the backdrop closes it, focus moves
 * into it on open and returns to where it was on close, Tab stays inside.
 */
export function Modal(props: { title: string; onClose(): void; children: ReactNode; wide?: boolean; className?: string }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    // a child's autoFocus has already run; otherwise the first text field, else the main action
    if (el && !el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>('input[type=text], input:not([type]), textarea') ?? el.querySelector<HTMLElement>('.modal-actions .btn:last-child'))?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); before?.focus?.(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div ref={box} className={`modal${props.wide ? ' modal-wide' : ''}${props.className ? ` ${props.className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{props.title}</h2>
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={props.onClose}>×</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

/** A yes/no question with a clear action label (e.g. "Delete project"). */
export function ConfirmDialog(props: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm(): void | Promise<void>; onClose(): void;
}) {
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div className="modal-section">{props.children}</div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={props.onClose}>Cancel</button>
        <button className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => void props.onConfirm()}>{props.confirmLabel}</button>
      </div>
    </Modal>
  );
}
