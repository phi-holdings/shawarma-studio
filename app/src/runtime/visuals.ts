// Song visuals inside the runtime iframe: inline widgets (`._pianoroll()`, `._scope()`,
// `._punchcard()`, `._spiral()`, `._pitchwheel()`, `._spectrum()`), full-panel draws
// (`.pianoroll()`, `.scope()`, `.draw()`) and painters (`.punchcard()`, `.onPaint()`).
// The iframe doubles as the visualisation panel below the editor; the parent sizes it from the
// height reported here. Compile-only evaluations (checks, renders) never start animations.
import { Pattern } from '@strudel/core';
import { registerWidget } from '@strudel/codemirror';
import { getWidgetID } from '@strudel/transpiler';
import { Drawer, cleanupDraw, getDrawContext } from '@strudel/draw';

export const FULL_PANEL_HEIGHT = 200;

interface WidgetConfig { type: string; to: number; index?: number; id?: string }

export function createVisuals(container: HTMLElement, onHeight: (height: number) => void) {
  let compiling = 0;
  let drawCalls = 0;
  let inlineCalls = 0;
  let painters = 0;
  const canvases = new Map<string, HTMLCanvasElement>();

  const canvasFor = (id: string, options: { width?: number; height?: number; pixelRatio?: number }) => {
    const { width = 500, height = 60, pixelRatio = window.devicePixelRatio } = options;
    let c = canvases.get(id);
    if (!c) {
      c = document.createElement('canvas');
      c.id = id;
      c.className = 'widget';
      canvases.set(id, c);
    }
    c.width = width * pixelRatio;
    c.height = height * pixelRatio;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    if (!c.isConnected) container.appendChild(c);
    return c;
  };

  // Same widgets as @strudel/codemirror's, but the canvases live in this panel instead of the editor.
  const inline = (type: string, make: (id: string, options: any, pat: any) => any) =>
    registerWidget(type, (id: string, options: any = {}, pat: any) => {
      if (compiling) return pat;
      inlineCalls++;
      return make(id, options, pat);
    });
  inline('_pianoroll', (id, options, pat) => pat.tag(id).pianoroll({ fold: 1, ...options, ctx: canvasFor(id, options).getContext('2d'), id }));
  inline('_punchcard', (id, options, pat) => pat.tag(id).punchcard({ fold: 1, ...options, ctx: canvasFor(id, options).getContext('2d'), id }));
  inline('_spiral', (id, options, pat) => {
    const size = options.size || 275;
    const o = { width: size, height: size, ...options, size: size / 5 };
    return pat.tag(id).spiral({ ...o, ctx: canvasFor(id, o).getContext('2d'), id });
  });
  inline('_scope', (id, options, pat) => {
    const o = { width: 500, height: 60, pos: 0.5, scale: 1, ...options };
    return pat.tag(id).scope({ ...o, ctx: canvasFor(id, o).getContext('2d'), id });
  });
  inline('_pitchwheel', (id, options, pat) => {
    const size = options.size || 200;
    const o = { width: size, height: size, ...options, size: size / 5 };
    return pat.pitchwheel({ ...o, ctx: canvasFor(id, o).getContext('2d'), id });
  });
  inline('_spectrum', (id, options, pat) => {
    const size = options.size || 200;
    const o = { width: size, height: size, ...options, size: size / 5 };
    return pat.spectrum({ ...o, ctx: canvasFor(id, o).getContext('2d'), id });
  });

  // .draw() starts a requestAnimationFrame loop: never for compile-only evaluations
  const draw = Pattern.prototype.draw;
  Pattern.prototype.draw = function (this: unknown, ...args: unknown[]) {
    if (compiling) return this;
    drawCalls++;
    return draw.apply(this, args);
  };

  // painters (.punchcard(), .onPaint()) are driven like StrudelMirror's Drawer does
  let drawTime: [number, number] = [-2, 2];
  const drawer = new Drawer((haps: any[], time: number, _d: unknown, ps: any[]) => {
    const ctx = getDrawContext();
    for (const p of ps ?? []) p(ctx, time, haps, drawTime);
  }, drawTime);

  let lastHeight = -1;
  const report = () => {
    const inlineHeight = canvases.size ? Math.ceil(container.getBoundingClientRect().height) : 0;
    const full = painters > 0 || drawCalls > inlineCalls;
    const h = Math.max(inlineHeight, full ? FULL_PANEL_HEIGHT : 0);
    if (h !== lastHeight) { lastHeight = h; onHeight(h); }
  };

  return {
    async whileCompiling<T>(fn: () => Promise<T>): Promise<T> {
      compiling++;
      try { return await fn(); } finally { compiling--; }
    },
    beforeLiveEval() {
      cleanupDraw(true);           // stops the previous evaluation's animations, clears the panel
      drawCalls = 0; inlineCalls = 0;
    },
    afterLiveEval(widgets: WidgetConfig[], pattern: any, scheduler: any) {
      const keep = new Set(widgets.filter((w) => w.type !== 'slider').sort((a, b) => a.to - b.to).map((w) => getWidgetID(w)));
      for (const [id, c] of canvases) if (!keep.has(id)) { c.remove(); canvases.delete(id); }
      for (const id of keep) { const c = canvases.get(id); if (c) container.appendChild(c); } // source order
      painters = pattern?.getPainters?.().length ?? 0;
      drawTime = painters ? [-2, 2] : [0, 0];
      drawer.setDrawTime(drawTime);
      if (scheduler?.pattern) drawer.invalidate(scheduler);
      report();
    },
    onToggle(started: boolean, scheduler: any) {
      if (started) drawer.start(scheduler);
      else { drawer.stop(); cleanupDraw(true); }
    },
    /** Panel height for the current evaluation (also re-sent after reconnects). */
    resend() { lastHeight = -1; report(); },
  };
}
