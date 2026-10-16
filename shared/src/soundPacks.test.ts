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
