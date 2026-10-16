import { expect, test } from 'vitest';
import { parseSoundPackSet, soundCreditsFor, soundPacksFor, SOUND_PACKS, usesOnlySoundsOf } from './soundPacks';

test('hosted offers only the cleanly licensed packs; local mode keeps all of them', () => {
  expect(soundPacksFor('hosted').map((p) => p.id)).toEqual(['piano', 'vcsl', 'uzu-drumkit', 'mridangam']);
  expect(soundPacksFor('all').map((p) => p.id)).toEqual(SOUND_PACKS.map((p) => p.id));
  expect(soundPacksFor('all').map((p) => p.id)).toEqual(['piano', 'vcsl', 'tidal-drum-machines', 'uzu-drumkit', 'uzu-wavetables', 'mridangam']);
  // every hosted pack has a licence to show, and the GM instruments are credited too
  for (const c of soundCreditsFor('hosted')) expect(c.licenceUrl).toMatch(/^https:\/\//);
  expect(soundCreditsFor('hosted').map((c) => c.licence)).toEqual(['CC BY 3.0', 'CC0 1.0', 'Unlicense', 'CC BY-SA 4.0', 'MIT (as published)']);
});

test('SOUND_PACKS: empty means all, anything but hosted/all is refused', () => {
  expect(parseSoundPackSet(undefined)).toBe('all');
  expect(parseSoundPackSet('')).toBe('all');
  expect(parseSoundPackSet(' Hosted ')).toBe('hosted');
  expect(parseSoundPackSet('all')).toBe('all');
  expect(() => parseSoundPackSet('safe')).toThrow(/SOUND_PACKS must be hosted or all/);
});

test('code that names drum machines, wavetables or Dirt sounds does not fit the hosted set', () => {
  expect(usesOnlySoundsOf('s("bd sd").bank("RolandTR909")', 'hosted')).toBe(false);
  expect(usesOnlySoundsOf("s('bd').bank('tr808')", 'hosted')).toBe(false);
  expect(usesOnlySoundsOf('s("squelch").bank("wt_digital")', 'hosted')).toBe(false);
  expect(usesOnlySoundsOf('s("<casio:1 bd>")', 'hosted')).toBe(false);
  expect(usesOnlySoundsOf('sound("wt_vgame:3")', 'hosted')).toBe(false);
  expect(usesOnlySoundsOf('s("ta ki").bank("mridangam")', 'hosted')).toBe(true);
  expect(usesOnlySoundsOf('s("bd*4, [~ hh]*4").gain(.8)\nnote("c e").s("piano")', 'hosted')).toBe(true);
  expect(usesOnlySoundsOf('s("bd").bank("RolandTR909")', 'all')).toBe(true);
});

test('sound sources: a self-hosted packs URL, else Strudel\'s CDNs', async () => {
  const { GM_SOUNDFONT_CDN, SAMPLE_CDN, soundSources } = await import('./soundPacks');
  expect(soundSources(null)).toEqual({ samples: SAMPLE_CDN, soundfonts: GM_SOUNDFONT_CDN });
  expect(soundSources('')).toEqual({ samples: SAMPLE_CDN, soundfonts: GM_SOUNDFONT_CDN });
  expect(soundSources('https://shawarma.example/packs/')).toEqual({ samples: 'https://shawarma.example/packs', soundfonts: 'https://shawarma.example/packs/gm' });
  expect(soundSources('https://shawarma.example/packs?x=1#y')).toEqual({ samples: 'https://shawarma.example/packs', soundfonts: 'https://shawarma.example/packs/gm' });
  // not http(s): ignored
  for (const bad of ['javascript:alert(1)', 'data:text/plain,x', 'packs', '//evil.example/packs']) expect(soundSources(bad).samples, bad).toBe(SAMPLE_CDN);
});

test('a sample map rewritten to our origin: every _base points at the pack folder, the sounds stay', async () => {
  const { rewriteSampleMap, sampleMapFiles } = await import('./soundPacks');
  const map = {
    _base: 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/',
    bd: ['bd/10_bd.wav', 'bd/11_bd.wav'],
    piano: { _base: 'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano/', A0: 'A0v8.mp3', C1: ['C1v8.mp3'] },
    ws: ['Aerophones/Ball%20Whistle/Long-001.wav'],
  };
  const out = rewriteSampleMap(map, 'https://shawarma.example/packs/uzu-drumkit');
  expect(out).toEqual({
    _base: 'https://shawarma.example/packs/uzu-drumkit/',
    bd: ['bd/10_bd.wav', 'bd/11_bd.wav'],
    piano: { _base: 'https://shawarma.example/packs/uzu-drumkit/', A0: 'A0v8.mp3', C1: ['C1v8.mp3'] },
    ws: ['Aerophones/Ball%20Whistle/Long-001.wav'],
  });
  expect(JSON.stringify(out)).not.toMatch(/githubusercontent|b-cdn/);
  // a map without _base gets one
  expect(rewriteSampleMap({ hh: ['hh.wav'] }, 'https://x.example/p/')).toEqual({ _base: 'https://x.example/p/', hh: ['hh.wav'] });
  expect(sampleMapFiles(map).sort()).toEqual(['A0v8.mp3', 'Aerophones/Ball%20Whistle/Long-001.wav', 'C1v8.mp3', 'bd/10_bd.wav', 'bd/11_bd.wav']);
});
