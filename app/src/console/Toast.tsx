import { useEffect, useRef } from 'react';
import { toastMs, toasts, useToast } from './toastStore';
import './toast.css';

/** The latest notice, at the bottom of the song panel; dismisses itself (paused while hovered). */
export function ToastArea(props: { onOpenConsole(): void }) {
  const t = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arm = () => { clearTimeout(timer.current); if (t) timer.current = setTimeout(() => toasts.dismiss(t.id), toastMs(t)); };
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, [t]);
  return (
    <div className="toast-area" role="status" aria-live="polite">
      {t && (
        <div key={t.id} className={`toast toast-${t.kind}`} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={arm}>
          <span className="toast-msg">{t.message}</span>
          {t.kind === 'error' && <button type="button" className="toast-link" onClick={() => { toasts.dismiss(t.id); props.onOpenConsole(); }}>Console</button>}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => toasts.dismiss(t.id)}>×</button>
        </div>
      )}
    </div>
  );
}
