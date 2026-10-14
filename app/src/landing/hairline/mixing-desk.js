// @ts-nocheck
// A Hairline figure for Shawarma REPL, drawn with the hairline-create skill (source: design/figures/mixing-desk.js).
import HL from './kernel.js';
let figure;
const hairline = (f) => { figure = f; };
/**
 * Mixing desk: eight channel strips and a master on a sloped console. Each
 * strip has two knobs at the back and a fader cap riding in a long slot. The
 * pointer is projected onto the deck, which never moves: its depth along the
 * slots is a level, and the fader under it rises or falls to meet it while its
 * neighbours follow less with distance, each on its own spring. At rest the
 * faders hold a mix; the bass cap is bright. The slider is the reach, in strips.
 */
const {
  Cam, circ, clamp, facing, fit, hull, open, poly, prism, proj, rings, rrect, run, seg, unproj,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const N = 8, PITCH = 16, MX = 144, X0 = -2, X1 = 156, Y0 = 0, Y1 = 112;
const YA = 31, YB = 104, CH = 8, CL = 4.6, ZB = 7, SL = 0.17, KR = 3.4;
const LAYERS = ["kick", "snare", "hats", "bass", "keys", "pad", "lead", "fx"];
const MIX = [0.74, 0.56, 0.38, 0.84, 0.47, 0.28, 0.63, 0.18, 0.7];
const MARK = 3;

/** The deck's height at depth y: it rises toward the back. */
const zTop = (y) => ZB + (Y1 - y) * SL;
/** A fader's level, 0 at the front of its slot to 1 at the back, as the depth of its cap's centre. */
const yOf = (t) => YB - CL - t * (YB - YA - 2 * CL);
const tOf = (y) => (YB - CL - y) / (YB - YA - 2 * CL);
const falloff = (u) =>
  u <= 0 ? 1 : u <= 0.417 ? 1 - (u / 0.417) * 0.6875 : u <= 1 ? 0.3125 - ((u - 0.417) / 0.583) * 0.2185 : 0.094;
const at = (ring, x, y) => ring.map((q) => ({ ...q, u: q.u + x, v: q.v + y }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  const C = Cam(45, 0.5, 1.52);
  fit(C, [[X0, Y0, 0], [X1, Y1, 0], [X1, Y0, 0], [X0, Y1, 0], [X0, Y0, zTop(Y0)], [X1, Y0, zTop(Y0)], [X0, YA, zTop(YA) + CH]], 200, 172);
  const P = proj(C), front = facing(C), S = (u, v) => P(u, v, zTop(v));
  let R = value, over = null;

  const g = mk("g", {}, svg);
  // The deck: a wedge, its foot flat and its top sloped, so its two rings are written here.
  const foot = rrect(X0, Y0, X1, Y1, 9, 6), inner = rrect(X0 + 2, Y0 + 2, X1 - 2, Y1 - 2, 7, 6);
  put(solid(g), {
    sil: poly(hull(foot.map((q) => P(q.u, q.v, 0)).concat(foot.map((q) => S(q.u, q.v))))),
    crease: open(run(inner, front).map((q) => S(q.u, q.v))),
  });
  // The master's strip is set off from the eight by a seam across the deck.
  mk("path", { d: seg(S(MX - 10, Y0 + 6), S(MX - 10, Y1 - 6)), class: "nf lo" }, g);

  const strips = [];
  for (let i = 0; i <= N; i++) {
    const x = i < N ? 8 + i * PITCH : MX, w = i < N ? 5 : 7;
    const slot = mk("path", { d: poly(rrect(x - 1.3, YA, x + 1.3, YB, 1.3, 4).map((q) => S(q.u, q.v))), class: "nf" }, g);
    strips.push({ i, x, w, slot, sp: spring(yOf(MIX[i]), { eps: 0.03 }), drawn: NaN });
  }
  // Two knobs per channel strip, each turned to its own setting by a pointer line on its cap.
  for (let i = 0; i < N; i++) for (const [k, ky] of [[0, 9], [1, 20.5]]) {
    const x = strips[i].x, z0 = zTop(ky + KR) - 0.4, z1 = zTop(ky) + 3.2, a = -2.4 + ((i * 5 + k * 3) % 7) * 0.62;
    const el = solid(g);
    put(el, prism(P, front, at(circ(KR, 16), x, ky), at(circ(KR - 0.8, 16), x, ky), z0, z1));
    mk("path", { d: seg(P(x, ky, z1), P(x + 2.3 * Math.cos(a), ky + 2.3 * Math.sin(a), z1)), class: "nf" }, el.g);
  }
  // The caps, after every knob and slot: no cap shares screen with another strip's parts nearer than it.
  for (const s of strips) { s.cap = solid(g); s.ridge = mk("path", { class: "nf lo" }, s.cap.g); }

  function drawCap(s) {
    const y = s.sp.x;
    if (y === s.drawn) return;
    s.drawn = y;
    const [ring, inr] = rings(s.x - s.w, y - CL, s.x + s.w, y + CL, 1.8, 0.9);
    const z0 = zTop(y + CL) - 0.3, z1 = zTop(y) + CH;
    put(s.cap, prism(P, front, ring, inr, z0, z1));
    s.ridge.setAttribute("d", seg(P(s.x - s.w + 1.4, y, z1), P(s.x + s.w - 1.4, y, z1)));
  }

  let lit = -1;
  function light(a) {
    if (a === lit) return;
    lit = a;
    strips.forEach((s) => { s.cap.sil.classList.toggle("hi", s.i === a); s.slot.classList.toggle("hi", s.i === a); });
  }
  light(MARK);

  const B = register(stage, (dt) => {
    let m = false;
    for (const s of strips) { if (stepS(s.sp, dt)) m = true; drawCap(s); }
    return m;
  });
  bag.add(B.unregister);

  /** The deck point under a screen point, at a cap's middle height: the deck is still, so this never moves. */
  function pick(sx, sy) {
    let z = zTop(Y1 / 2) + CH / 2, w = null;
    for (let k = 0; k < 6; k++) { w = unproj(C, sx, sy, z); z = zTop(clamp(w[1], Y0, Y1)) + CH / 2; }
    return w[0] < X0 || w[0] > X1 || w[1] < Y0 || w[1] > Y1 ? null : w;
  }

  function retarget() {
    if (!over) {
      strips.forEach((s) => { s.sp.t = yOf(MIX[s.i]); });
      light(MARK); read.textContent = "rest"; B.wake();
      return;
    }
    const a = over[0] > MX - 10 ? N : clamp(Math.round((over[0] - 8) / PITCH), 0, N - 1);
    const lv = clamp(tOf(over[1]), 0, 1);
    for (const s of strips) {
      // the master answers alone; a channel follows by its distance in strips
      const f = a === N || s.i === N ? (s.i === a ? 1 : 0) : falloff(Math.abs(s.i - a) / R);
      s.sp.t = yOf(clamp(MIX[s.i] + (lv - MIX[s.i]) * f, 0, 1));
    }
    light(a);
    read.textContent = a === N ? "master" : `ch ${a + 1} · ${LAYERS[a]}`;
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => { over = pick(p[0], p[1]); retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { R = v; if (over) retarget(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "mixing-desk",
  means: "A mixing desk: the pointer sets a level, the fader under it meets it, and its neighbours follow less with distance.",
  rules: [1, 3, 4, 5],
  range: [1.5, 4, 8],
  tour: [[143, 113], [167, 200], [285, 189], null],
  mount,
});

export default figure;
