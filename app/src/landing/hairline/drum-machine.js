// @ts-nocheck
// A Hairline figure for Shawarma REPL, drawn with the hairline-create skill (source: design/figures/drum-machine.js).
import HL from './kernel.js';
let figure;
const hairline = (f) => { figure = f; };
/**
 * Drum machine: a step sequencer in the 2:1 view. Sixteen pads run along the
 * front in four groups of four, a beat already punched in (four on the floor
 * and a few off-beats, those pads sitting low with their light on); four knobs
 * and a display window sit on the raised deck behind. The pointer picks a
 * step: its pad presses down and the pads around it ripple, a trough beside it
 * and a crest a few steps out, staggered outwards on the 700ms lift curve. The
 * slider is the stagger, in ms.
 *
 * The pattern: discrete items, as Riffle. The hit test unprojects onto the
 * plane of the pads' resting tops, which never moves, and picks the nearest
 * step by its resting centre, so a pad sinking under the pointer cannot flip it.
 */
const {
  Cam, circ, clamp, facing, fit, poly, prism, proj, put, ringAt, rings, rrect, seg, solid,
  tdone, tset, tval, tween, unproj, disposer, flatDot, mk, place, pointer, reflect, register,
} = HL;

const N = 16, PW = 10, PD = 13, PG = 2.5, GG = 7;
const UP = 8.5, ON = 3, PRESS = 0.6, CREST = 4;
// the ripple, by distance from the pressed step: a trough beside it, a crest further out, then still
const WAVE = [0, -3.5, -1, 2.5, CREST, 2.5, 1];
const BH = 10, DH = 8, X0 = -10, X1 = 221, Y0 = 0, Y1 = 88, DY = 36, PY = 60;
const BEAT = [0, 4, 7, 8, 10, 12, 15], HEAD = 4;
// x, y, and where each knob's notch points, in degrees: a setting, not a row of zeros
const KNOBS = [[18, 18, -150], [46, 18, -60], [74, 18, 20], [102, 18, -110]], KR = 7, KC = 5;

/** Step i's left edge: the pads close up inside a group and open up between groups. */
const px = (i) => i * (PW + PG) + Math.floor(i / 4) * (GG - PG);
const cx = (i) => px(i) + PW / 2;
const at = (ring, x, y) => ring.map((q) => ({ ...q, u: q.u + x, v: q.v + y }));
/** Where a pad's top rests when nobody touches it: up, or low if its step is punched in. */
const base = (i) => (BEAT.includes(i) ? ON : UP);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  // Fitted to the whole slab, the knobs' caps and the reflection, so no pose leaves the frame.
  const C = Cam(45, 0.5, 1.3);
  fit(C, [[X0, Y0, 0], [X1, Y0, 0], [X0, Y1, -8], [X1, Y1, -8], [X0, Y0, BH + DH + 8], [X1, Y0, BH + DH], [X1, Y1, BH + UP + CREST]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const [bodyR, bodyI] = rings(X0, Y0, X1, Y1, 7, 1.6);
  reflect(svg, g, P, front, bodyR, 0, 14);
  put(solid(g), prism(P, front, bodyR, bodyI, 0, BH));

  // the deck along the back, a step up from the slab
  const [deckR, deckI] = rings(X0 + 4, Y0 + 4, X1 - 4, DY, 5, 1.4), ZD = BH + DH;
  put(solid(g), prism(P, front, deckR, deckI, BH, ZD));

  // the display: a window set into the deck, its glass a step inside the bezel
  mk("path", { d: poly(ringAt(P, rrect(132, 11, 206, 29, 3, 4), ZD)), class: "nf" }, g);
  mk("path", { d: poly(ringAt(P, rrect(134.5, 13.5, 203.5, 26.5, 1.8, 4), ZD)), class: "nf lo" }, g);

  // the knobs: a skirt, a cap, and a notch that says where each is set
  for (const [x, y, deg] of KNOBS) {
    const skirt = at(circ(KR, 24), x, y), skirtIn = at(circ(KR - 1.2, 24), x, y);
    const cap = at(circ(KC, 24), x, y), capIn = at(circ(KC - 1, 24), x, y);
    put(solid(g), prism(P, front, skirt, skirtIn, ZD, ZD + 2));
    put(solid(g), prism(P, front, cap, capIn, ZD + 2, ZD + 8));
    const a = (deg * Math.PI) / 180;
    mk("path", { d: seg(P(x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2, ZD + 8), P(x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.6, ZD + 8)), class: "nf" }, g);
  }

  // the pads, far to near; each has its light set into its top
  const pads = [];
  for (let i = 0; i < N; i++) {
    const [ring, inner] = rings(px(i), PY, px(i) + PW, PY + PD, 2.6, 1);
    const s = solid(g), led = flatDot(g, C, 1.5, "dot off");
    pads.push({ ring, inner, s, led, z: tween(base(i)), h: NaN });
  }

  // the bars under each group of four, printed on the lip in front of the pads
  for (let k = 0; k < 4; k++) {
    mk("path", { d: seg(P(px(4 * k) + 1, Y1 - 8, BH), P(px(4 * k + 3) + PW - 1, Y1 - 8, BH)), class: "nf lo" }, g);
  }

  function draw(i, h) {
    const pd = pads[i];
    if (h === pd.h) return;
    pd.h = h;
    put(pd.s, prism(P, front, pd.ring, pd.inner, BH, BH + h));
    place(pd.led, P(cx(i), PY + PD / 2, BH + h));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    pads.forEach((pd, i) => { draw(i, tval(pd.z, now)); if (!tdone(pd.z, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  /** The one bright step: the playhead at rest, the pointer's step when it picks one. */
  function mark(m) {
    pads.forEach((pd, i) => {
      pd.s.sil.classList.toggle("hi", i === m);
      pd.led.setAttribute("class", i === m ? "dot" : BEAT.includes(i) ? "dot m" : "dot off");
    });
  }
  pads.forEach((pd, i) => draw(i, base(i)));
  mark(HEAD);

  // hit: the plane of the pads' RESTING tops, which never moves; nearest resting centre wins
  function hit([x, y]) {
    const [wx, wy] = unproj(C, x, y, BH + UP);
    if (wy < PY - 8 || wy > Y1 + 4 || wx < X0 || wx > X1) return -1;
    let best = 0;
    for (let i = 1; i < N; i++) if (Math.abs(wx - cx(i)) < Math.abs(wx - cx(best))) best = i;
    return best;
  }

  /** Where step i's pad goes with step a pressed: the pressed one bottoms out, the rest ride the ripple, clamped. */
  function target(i, a) {
    if (a < 0) return base(i);
    if (i === a) return PRESS;
    return clamp(base(i) + (WAVE[Math.abs(i - a)] ?? 0), PRESS, UP + CREST);
  }

  let act = -1;
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    pads.forEach((pd, i) => tset(pd.z, target(i, a), now, Math.abs(i - from) * stag));
    mark(a < 0 ? HEAD : a);
    read.textContent = a < 0 ? "rest" : "step " + String(a + 1).padStart(2, "0");
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "drum-machine",
  means: "A step sequencer with a beat punched in: the step under the pointer presses down, and a ripple runs out along the pads.",
  rules: [1, 2, 4, 5],
  range: [0, 45, 90],
  tour: [[110, 131], [160, 156], [237, 195], null],
  mount,
});

export default figure;
