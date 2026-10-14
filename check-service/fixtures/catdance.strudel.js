// Baghdad to Yerevan to Andalus: full song
// Hymn > Muwashshah > Iraqi chalghi > SOAD > Hymn > SOAD outro > Piano
setcpm(30) // 120 BPM

// ================= HYMN I: CHOIR A CAPPELLA (SATB) =================
// Dm  Bb  C  F/A  Gm  Dm  A  Dm
const satb = note(`<
  [a4,f4,d4,d3]
  [bb4,f4,d4,bb2]
  [c5,e4,g3,c3]
  [a4,f4,c4,a2]
  [bb4,g4,d4,g2]
  [a4,f4,d4,d3]
  [c#5,e4,a3,a2]
  [d5,f4,a3,d3]
>`)
const choir = satb.s("gm_choir_aahs").attack(1.2).release(2.5)
  .gain(.55).room(.9).size(8)
const oohs = satb.s("gm_voice_oohs").attack(1.5).release(2.5)
  .gain(.3).room(.9).size(8)
const descant = note(`<
  [~@4 d5@2 e5@2] [f5@6 e5@2] [e5@4 g5@4] [f5@8]
  [g5@3 f5 d5@4] [d5@4 f5@2 e5@2] [e5@4 c#5@4] [d5@8]
>`).s("gm_voice_oohs").gain(.35).room(.9).size(8)

const bell = note("<d4 ~ ~ ~>").s("gm_tubular_bells").gain(.35).room(.9)
const dam  = note("[38,50]").s("gm_bassoon").gain(.3).room(.6)

const hymnChoir = stack(choir, oohs, descant, bell, dam)

// ================= HYMN II: DUDUK + CHOIR =================
const duduk = note(`<
  [a4@4 bb4 a4 g4@2]
  [f4@2 g4 a4 g4@4]
  [d5@3 c5 bb4@2 a4 g4]
  [a4@8]
>`).slow(2).s("gm_english_horn").vib(4).vibmod(.12).attack(.2)
  .gain(.6).room(.8).size(6)

const hymnDuduk = stack(duduk, choir.gain(.4), oohs, dam, bell)

// ================= HYMN III: MUWASHSHAH ANDALUSI =================
// Maqam Nahawand on D, samai thaqil-style 10/8 (10 steps, slowed x2)
const mel = `<
  [d5@2 e5 f5@2 e5 d5 c#5 d5@2]
  [e5@2 f5 g5@2 f5 e5@2 d5@2]
  [a5@3 g5 f5@2 e5 f5 e5 d5]
  [c#5@2 d5 e5@2 d5@5]
>`
const call = note(mel).mask("<1 1 1 1 0 0 0 0>")
  .s("gm_voice_oohs").vib(5).vibmod(.15).gain(.6).room(.7)
const response = note(mel).mask("<0 0 0 0 1 1 1 1>")
  .superimpose(x => x.add(note(-12)))
  .s("gm_choir_aahs").gain(.55).room(.8).size(6)
const mOud = note(mel).add(note(-12))
  .s("gm_acoustic_guitar_nylon").lpf(1800).decay(.3).sustain(.2).gain(.55)
const mQanun = note(mel).off(1/20, x => x.add(note(12)).gain(.15))
  .s("gm_dulcimer").decay(.15).sustain(0).gain(.3).room(.5)
const sDoum = note("45").struct("x ~ ~ ~ ~ ~ x x ~ ~")
  .s("sine").decay(.4).sustain(0).gain(.9)
const sTak = stack(s("white").bpf(3000), note("81").s("triangle"))
  .struct("~ ~ ~ ~ x ~ ~ ~ x ~").decay(.05).sustain(0).gain(.35)
const sRiq = s("white").struct("~ x ~ x ~ x ~ ~ ~ x")
  .hpf(8500).decay(.06).sustain(0).gain(.12)
const mDrone = note("[38,45,50]").s("gm_choir_aahs").gain(.2).room(.9)

const muwashshah = stack(call, response, mOud, mQanun,
                         sDoum, sTak, sRiq, mDrone).slow(2)

// ================= IRAQI CHALGHI =================
// Maqam Bayat on D (63.5 = E half-flat)
const doum = note("50").struct("x ~ ~ ~ ~ ~ x ~ x ~ ~ ~ ~ ~ ~ ~")
  .s("sine").decay(.35).sustain(0).gain(1)
const tak = stack(s("white").bpf(3200), note("81").s("triangle"))
  .struct(`<
    [~ ~ x ~ x ~ ~ ~ ~ ~ x ~ x ~ x ~]
    [~ ~ x ~ x ~ ~ ~ ~ ~ x ~ x ~ x ~]
    [~ ~ x ~ x ~ ~ ~ ~ ~ x ~ x ~ x ~]
    [~ ~ x ~ x ~ ~ ~ [x x] [x x] [x x] [x x] [x x] [x x] [x x] [x x]]
  >`).decay(.05).sustain(0).gain(.4)
const ka = s("white").struct("~ x ~ x ~ x ~ x ~ x ~ x ~ x ~ x")
  .bpf(5000).decay(.02).sustain(0).gain(".12 .06")
const riq = s("white").struct("~ ~ x ~ x ~ ~ x ~ ~ x ~ x ~ ~ x")
  .hpf(8500).decay(.06).sustain(0).gain(.15)
const naqqara = note("<[57 ~ ~ 57 ~ ~ ~ ~] [57 ~ ~ 57 ~ 57 ~ ~]>")
  .s("sine").decay(.12).sustain(0).gain(.4)
const darbuka = stack(doum, tak, ka, riq)

const oud = note(`<
  [50 ~ 57 50 62 60 58 57 55 ~ 57 55 53 55 51.5 50]
  [50 ~ 53 55 57 58 60 58 57 ~ 55 53 51.5 53 50 ~]
>`).s("gm_acoustic_guitar_nylon").lpf(1800).decay(.25).sustain(.2)
  .gain(.7).room(.3)

const joza = note(`<
  [69@3 70 69@2 67 65] [67@2 69 70 72@4]
  [74@3 72 70@2 69 70] [69@6 ~ ~]
  [74@3 75.5 74@2 72 70] [72@2 70 69 67@4]
  [65@3 67 69@2 67 65] [63.5 65 63.5 62@5]
>`).s("gm_fiddle").vib(5.5).vibmod(.2).attack(.06).gain(.55).room(.5)

const santur = note("<[74,69] [72,67] [70,65] [69,62]>").struct("x*16")
  .s("gm_dulcimer").decay(.1).sustain(0)
  .gain(sine.range(.12, .32).fast(2)).room(.5)

const drone = note("[38,45]").s("sawtooth").lpf(700)
  .attack(1).release(2).gain(.18)

// ================= SOAD HEAVY =================
// drop-D chugs in D Hijaz (D Eb F# G A Bb C)
const riff = note(`<
  [[38,45] [38,45] ~ [38,45] ~ [38,45] 39 ~ [38,45] [38,45] ~ [38,45] 42 ~ 43 ~]
  [[38,45] [38,45] ~ [38,45] ~ [38,45] 39 ~ [46,53] ~ [45,52] ~ [43,50] ~ [42,49] 39]
>`).s("gm_distortion_guitar").decay(.15).sustain(.4).gain(.6)

const zurna = note(`<
  [d5 eb5 f#5 g5 a5@2 g5 f#5] [eb5@2 f#5 eb5 d5@4]
  [a5 bb5 a5 g5 f#5@2 g5 a5] [bb5@3 a5 g5 f#5 eb5 f#5]
  [d6@2 c6 bb5 a5@2 bb5 a5] [g5@2 f#5 g5 a5@4]
  [bb5 a5 g5 f#5 eb5 f#5 g5 f#5] [d5@8]
>`).s("gm_shanai").vib(6).vibmod(.15).gain(.5).room(.3)

const heavyChoir = note("<[d3,f#3,a3,d4,f#4] [d3,g3,bb3,d4,g4]>")
  .s("gm_choir_aahs").attack(.3).gain(.5).room(.7)

const rockKick  = s("bd bd ~ bd ~ ~ bd ~ bd bd ~ bd ~ ~ bd bd").gain(1)
const rockSnare = s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~").gain(.9)
const rockCym   = s("<cr ~ ~ ~>, hh*8").gain(".5 .3")

const heavy = stack(riff, zurna, heavyChoir,
                    rockKick, rockSnare, rockCym, tak.gain(.3))

// ================= SOAD OUTRO =================
const guitarSolo = note(`<
  [a4@4 bb4 a4 g4 f#4 g4@8]
  [d5@2 eb5@2 d5 c5 bb4 a4 bb4@8]
  [a4 bb4 c5 d5 eb5 f#5 g5 a5 bb5@4 a5@4]
  [g5@2 f#5@2 eb5@2 d5@2 eb5@8]
  [d6@6 c6 bb5 a5@8]
  [bb5 a5 g5 f#5 g5 f#5 eb5 d5 eb5@8]
  [d5 f#5 a5 d6 c6 a5 f#5 eb5 d5 f#5 a5 d6 eb6@4]
  [d6@12 ~@4]
>`).s("gm_distortion_guitar").vib(6).vibmod(.2)
  .gain(.55).room(.4).delay(.2).delaytime(.25).delayfeedback(.3)

const outroHeavy = stack(riff, guitarSolo, heavyChoir,
                         rockKick, rockSnare, rockCym, tak.gain(.3))

const shred = note(`<
  [d5 eb5 f#5 g5 a5 bb5 c6 d6 eb6 d6 c6 bb5 a5 g5 f#5 eb5]*2
  [[a5 bb5 a5 g5]*4 [f#5 g5 f#5 eb5]*4]
  [d6 eb6 d6 c6 bb5 a5 bb5 c6]*4
  [[d5 f#5 a5 d6]*4 d6]
>`).s("gm_distortion_guitar").vib(7).vibmod(.25).gain(.5).room(.4)

const climaxChords = note("<[38,45,50]*8 [39,46,51]*8 [36,43,48]*8 [38,45,50]*8>")
  .s("gm_distortion_guitar").decay(.2).sustain(.5).gain(.5)

const climax = stack(shred, climaxChords, heavyChoir,
  s("bd*16").gain(.8),
  s("[~ sd]*4").gain(.9),
  s("cr, hh*16").gain(".5 .2"))

const finalHit = stack(
  note("[38,45,50,57]").slow(4).s("gm_distortion_guitar").release(3).gain(.6),
  note("[d3,a3,d4,f#4,a4]").slow(4).s("gm_choir_aahs").release(3)
    .gain(.5).room(.9).size(8),
  note("d4").slow(4).s("gm_tubular_bells").gain(.4).room(.9),
  s("cr").slow(4).gain(.6),
  s("bd").slow(4).gain(1.1)
)

// ================= SERENE PIANO ENDING =================
// Dm  A  Bb  F  Gm  A  Dm  D
const pianoRH = note(`<
  [d4@2 a4@2 f5@4]
  [e5@2 d5@2 a4@4]
  [bb3@2 f4@2 d5@4]
  [c5@2 bb4@2 a4@4]
  [g3@2 d4@2 bb4@4]
  [a4@4 c#5@4]
  [d5@2 e5 f5 e5@4]
  [[d4,f#4,a4,d5]@8]
>`).s("piano").gain(.55).room(.8).size(6)

const pianoLH = note("<d2 a1 bb1 f2 g1 a1 d2 [d2,a2]>")
  .s("piano").gain(.45).room(.8).size(6)

const hum = oohs.gain(.15).mask("<1 1 1 1 0 0 0 0>")

const pianoEnd = stack(pianoRH, pianoLH, hum)

// ================= SECTIONS =================
const solo    = stack(darbuka, naqqara, choir.gain(.2))
const enter   = stack(darbuka, naqqara, oud, drone)
const iraqi   = stack(darbuka, naqqara, oud, joza, santur, drone)
const reprise = stack(duduk, choir, oohs, descant, bell, dam)
const finale  = stack(heavy, darbuka, naqqara, choir.gain(.35), bell)

arrange(
  [8,  hymnChoir],   // I.   choir a cappella
  [8,  hymnDuduk],   // II.  duduk over choir
  [16, muwashshah],  // III. Andalusian muwashshah
  [4,  solo],        // darbuka solo
  [4,  enter],       // oud joins
  [8,  iraqi],       // Iraqi chalghi
  [8,  heavy],       // SOAD drop
  [8,  reprise],     // hymn returns
  [8,  finale],      // everything + choir
  [8,  outroHeavy],  // SOAD outro + guitar solo
  [4,  climax],      // fast-run climax
  [4,  finalHit],    // the big last chord
  [8,  pianoEnd],    // serene piano
  [4,  silence]      // end, press Ctrl+. here
)