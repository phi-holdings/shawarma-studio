// One transient notice at a time, shown over the song panel whatever tab is open (Toast.tsx).
import { useSyncExternalStore } from 'react';

export interface Toast { id: number; message: string; kind: 'notice' | 'error' }

export function createToastStore() {
  let current: Toast | null = null;
  let nextId = 1;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((fn) => fn());
  return {
    get: () => current,
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    show(message: string, kind: Toast['kind'] = 'notice') {
      if (!message.trim()) return;
      current = { id: nextId++, message, kind };
      emit();
    },
    /** Hides the toast `id` (a newer one stays). */
    dismiss(id: number) { if (current?.id === id) { current = null; emit(); } },
  };
}

export const toasts = createToastStore();
export const useToast = () => useSyncExternalStore(toasts.subscribe, toasts.get);

/** How long a toast stays: long enough to read it (errors a bit longer). */
export const toastMs = (t: Toast) => Math.min(12_000, Math.max(t.kind === 'error' ? 7000 : 4000, t.message.length * 60));
