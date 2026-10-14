// @ts-nocheck
// A Hairline figure for Shawarma REPL, drawn with the hairline-create skill (source: design/figures/spit.js).
import HL from './kernel.js';
let figure;
const hairline = (f) => { figure = f; };
/**
 * Spit: the Shawarma REPL mark built as a solid. A cone of five stacked slices,
 * one per layer of a song, wider at the top, turns on a skewer between a cap
 * plate and a drip tray. Each slice has its own uneven edge, a shaved flat and
 * a few knife marks, so the turning reads. Hovering the cone dilates time: the
 * rate's spring drops so a slice can be read, and the slice under the pointer
 * takes the bright edge. At rest `keys`, shaved deepest, holds it. The slider
 * is the turning rate, in degrees per second.
 *
 * The pattern: dilate time. One spring on the rate, an ambient loop, and a hit
 * test on the slices' rest silhouettes (true circles), which never move.
 */
const {
  Cam, circ, facing, fit, hull, open, poly, prism, proj, ringAt, run, seg, spring, stepS,
  flatDot, mk, place, pointer, put, reflect, register, disposer, reducedMotion, solid,
} = HL;

const NAMES = ["drums", "bass", "pad", "keys", "vocals"]; // bottom to top
const N = 5, SH = 16, Z0 = 14, ZC = Z0 + N * SH, CAP = 3, TIP = ZC + CAP + 18, CR = 21;
const RT = [22, 25, 28, 31, 34], STEP = 5.6, B = 1.3, SEG = 96, LIT = 3, SLOW = 0.08;
const TR = 30, TRI = 26.5, TD = 5, SK = 1.6;

/** Slice i's own unevenness: two ripples, a shaved flat and its depth, and where its knife marks fall. */
const SL = RT.map((_, i) => ({
  p1: i * 2.1 + 0.4, p2: i * 1.3 + 2.2,
  sa: i * 2.4 + 1.1, cut: i === LIT ? 0.16 : 0.06 + 0.02 * (i % 2),
  marks: [0.3, 2.2, 4.1].map((a, k) => a + i * 0.9 + k * 0.25),
}));

/** The slice's radius at world angle phi, turned by th: R with ripples, pared back to a chord where it was shaved, its corners rounded. */
function radius(R, sl, phi, th) {
  const l = phi - th;
  const r = R * (1 + 0.045 * Math.sin(3 * l + sl.p1) + 0.022 * Math.sin(7 * l + sl.p2));
  const c = Math.cos(l - sl.sa);
  if (c <= 0) return r;
  const k = 1.4, h = (R * (1 - sl.cut)) / c;
  return Math.min(r, h) - k * Math.log(1 + Math.exp(-Math.abs(r - h) / k));
}

/** A ring of the slice's outline at size R, inset by `ins`: samples {u, v, nu, nv}, normals radial. */
function ring(R, sl, th, ins) {
  const out = [];
  for (let k = 0; k < SEG; k++) {
    const phi = (k / SEG) * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi), r = radius(R, sl, phi, th) - ins;
    out.push({ u: r * c, v: r * s, nu: c, nv: s });
  }
  return out;
}

/** Whether screen point p lies inside a convex polygon, whichever way round it winds. */
function inside(poly, [x, y]) {
  let sgn = 0;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cr === 0) continue;
    if (sgn === 0) sgn = Math.sign(cr);
    else if (Math.sign(cr) !== sgn) return false;
  }
  return true;
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let rate = value, act = -1, th = 0.6;

  // Fitted to the tray, its reflection, the cap and the skewer's tip: nothing else moves outward.
  const C = Cam(45, 0.5, 2.05);
  fit(C, [[-TR, -TR, -TD], [TR, TR, -TD - 10], [TR, -TR, -TD], [-TR, TR, -TD], [-RT[4] - 2, -RT[4] - 2, ZC], [0, 0, TIP]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);

  // The drip tray: a round dish, its inner wall, and three drips gone dim on the floor.
  const tray = circ(TR, 72);
  reflect(svg, g, P, front, tray, -TD, 12);
  put(solid(g), prism(P, front, tray, circ(TR - B, 72), -TD, 0));
  mk("path", { d: poly(ringAt(P, circ(TRI, 72), 0)), class: "nf lo" }, g);
  mk("path", { d: open(ringAt(P, run(circ(TRI, 72), (q) => !front(q)), -2.6)), class: "nf lo" }, g);
  for (const [x, y] of [[12, 6], [-4, 15], [15, -8]]) place(flatDot(g, C, 0.7, "dot off"), P(x, y, -2.6));

  // The skewer below the cone, rising out of the tray.
  const rod = circ(SK, 16), rodIn = circ(SK - 0.5, 16);
  put(solid(g), prism(P, front, rod, rodIn, -2.6, Z0 + 2));

  // The slices, bottom to top, so each wider one covers the top of the one below.
  const slices = RT.map((R, i) => {
    const el = solid(g), marks = mk("path", { class: "nf lo" }, el.g);
    return { i, R, F: R - STEP, z0: Z0 + i * SH, z1: Z0 + (i + 1) * SH, sl: SL[i], el, marks };
  });

  // The cap plate, small on the widest slice, and the skewer's tip standing through it.
  put(solid(g), prism(P, front, circ(CR, 72), circ(CR - B, 72), ZC, ZC + CAP));
  put(solid(g), prism(P, front, rod, rodIn, ZC + CAP, TIP));

  // Rest silhouettes for the hit test: true circles, unturned. They never move (rule 01).
  const bands = slices.map((s) => hull(ringAt(P, circ(s.R, 48), s.z1).concat(ringAt(P, circ(s.F, 48), s.z0))));
  const pick = (p) => { for (let i = N - 1; i >= 0; i--) if (inside(bands[i], p)) return i; return -1; };

  function drawSlice(s) {
    const top = ring(s.R, s.sl, th, 0), foot = ring(s.F, s.sl, th, 0), inner = ring(s.R, s.sl, th, B);
    put(s.el, {
      sil: poly(hull(ringAt(P, foot, s.z0).concat(ringAt(P, top, s.z1)))),
      crease: open(ringAt(P, run(inner, front), s.z1)),
    });
    // knife marks on the near side only; they slide round as the spit turns
    let d = "";
    for (const a of s.sl.marks) {
      const phi = a + th, c = Math.cos(phi), sn = Math.sin(phi);
      if ((c + sn) / Math.SQRT2 < 0.35) continue;
      const rf = radius(s.F, s.sl, phi, th) - 0.4, rt = radius(s.R, s.sl, phi, th) - B - 0.4;
      d += seg(P(rf * c, rf * sn, s.z0 + 2), P(rt * c, rt * sn, s.z1 - 2.5));
    }
    s.marks.setAttribute("d", d);
  }
  const draw = () => slices.forEach(drawSlice);

  const sp = spring(rate);
  const L = register(stage, (dt) => {
    stepS(sp, dt);
    if (reducedMotion()) { draw(); return false; }
    th += (sp.x * Math.PI / 180) * dt;
    draw();
    return true;
  });
  bag.add(L.unregister);

  /** Chooses slice a, or none: the rate's target drops while one is held, and the bright goes to it. */
  function setActive(a) {
    act = a;
    sp.t = a >= 0 ? rate * SLOW : rate;
    slices.forEach((s) => s.el.sil.classList.toggle("hi", s.i === (act >= 0 ? act : LIT)));
    read.textContent = act >= 0 ? NAMES[act] : "rest";
    L.wake();
  }
  setActive(-1);
  draw();

  bag.add(pointer(stage, { move: (p) => setActive(pick(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { rate = v; setActive(act); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "spit",
  means: "A song's layers stacked as a shawarma spit that turns; hovering slows it so the slice under the pointer can be read.",
  rules: [1, 4, 5, 8, 9],
  range: [8, 20, 40],
  tour: [[200, 116], [200, 220], [200, 142], null],
  mount,
});

export default figure;
