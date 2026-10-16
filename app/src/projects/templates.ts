/**
 * Starting points offered by the New project dialog. Each one is checked by the check service's inspect in a
 * unit test, against the hosted sound packs too, so they use only sounds every mode has (no drum-machine banks).
 */
export interface SongTemplate { id: string; name: string; description: string; code: string }

export const TEMPLATES: SongTemplate[] = [
  {
    id: 'empty-beat',
    name: 'Empty beat',
    description: 'A kick and hats at 120 BPM. A blank page with a pulse.',
    code: `setcpm(30) // 120 BPM

s("bd*4, [~ hh]*4").gain(.8)
`,
  },
  {
    id: 'house',
    name: 'House groove',
    description: 'Four-on-the-floor, off-beat bass and minor seventh stabs, in four sections.',
    code: `setcpm(31) // 124 BPM

const drums = s("bd*4, [~ cp]*2, [~ hh]*4, ~ ~ ~ oh").gain(.85)
const bass = note("<[c2 c3]*4 [a1 a2]*4 [f1 f2]*4 [g1 g2]*4>")
  .s("sawtooth").lpf(700).decay(.15).sustain(0).gain(.5)
const stabs = note("<[c4,eb4,g4,bb4] [a3,c4,eb4,g4] [f3,ab3,c4,eb4] [g3,bb3,d4,f4]>")
  .struct("[~ x]*2").s("piano").gain(.45).room(.3)

arrange(
  [4, drums],                        // intro
  [8, stack(drums, bass, stabs)],    // groove
  [4, stack(bass, stabs)],           // breakdown
  [8, stack(drums, bass, stabs)],    // groove again
)
`,
  },
  {
    id: 'ambient',
    name: 'Ambient pad',
    description: 'Slow major-seventh pads with a wandering filter and a few bell notes.',
    code: `setcpm(15) // 60 BPM

const pad = note("<[c3,g3,e4,b4] [a2,e3,c4,g4] [f2,c3,a3,e4] [g2,d3,b3,d4]>")
  .s("sawtooth").attack(1.5).release(3).lpf(sine.range(500, 1500).slow(16))
  .gain(.18).room(.9).size(8)
const bells = note("<e5 ~ b4 ~ g5 ~ ~ d5>").s("triangle")
  .decay(.8).sustain(0).gain(.25).delay(.4).room(.8)

arrange(
  [8, pad],                 // pads alone
  [8, stack(pad, bells)],   // bells drift in
)
`,
  },
  {
    id: 'maqam',
    name: 'Maqam groove',
    description: 'Maqsum rhythm on darbuka with an oud-like line in maqam Hijaz on D.',
    code: `setcpm(27.5) // 110 BPM, maqsum (dum tek - tek dum - tek -)

const dum = s("darbuka:0").struct("x ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ ~").gain(.9)
const tek = s("darbuka:4").struct("~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~, ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~").gain(.6)
const riq = s("white").struct("[~ x]*8").hpf(8000).decay(.04).sustain(0).gain(.08)
// Hijaz on D: D Eb F# G A Bb C
const oudLine = note(\`<
  [d4 ~ eb4 f#4 g4 ~ f#4 eb4]
  [d4 ~ f#4 g4 a4 bb4 a4 g4]
  [a4 ~ bb4 a4 g4 f#4 g4 ~]
  [f#4 eb4 d4 ~ ~ ~ d4 ~]
>\`).s("gm_acoustic_guitar_nylon").lpf(2000).decay(.3).sustain(.2).gain(.6).room(.3)
const drone = note("d2").s("sawtooth").lpf(300).gain(.12)

arrange(
  [4, stack(dum, tek, riq)],                 // percussion
  [8, stack(dum, tek, riq, oudLine, drone)], // the line enters
)
`,
  },
  {
    id: 'breakbeat',
    name: 'Breakbeat',
    description: 'A syncopated break with a rolling bass line.',
    code: `setcpm(34) // 136 BPM

const breakbeat = s("bd ~ ~ bd ~ ~ bd ~, ~ ~ sd ~ ~ sd ~ [~ sd], hh*8").gain(.85)
const bass = note("<[e1 ~ e2 ~ ~ e1 g1 ~] [a1 ~ a2 ~ ~ a1 b1 ~]>")
  .s("square").lpf(500).decay(.2).sustain(0).gain(.45)

arrange(
  [4, breakbeat],               // drums
  [8, stack(breakbeat, bass)],  // bass joins
)
`,
  },
];

export const BLANK_TEMPLATE = TEMPLATES[0];
