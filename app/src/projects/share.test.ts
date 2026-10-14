import { expect, test } from 'vitest';
// Strudel's own encoder, the one strudel.cc decodes with
import { code2hash as strudelCode2hash, hash2code as strudelHash2code } from '@strudel/core';
import { ImportError, code2hash, codeFromStrudelLink, hash2code, importName, strudelLink } from './share';

const SONGS = [
  's("bd sd")',
  'note("c e g").s("piano")\n// comment with "quotes" & ampersand + plus / slash = equals',
  '// مقام حجاز — ‘curly’ quotes, emoji 🎶, accents café\nnote("d4 eb4 f#4").s("gm_acoustic_guitar_nylon")',
  'x'.repeat(70_000),   // longer than one 0x8000 chunk
  '',
];

test('code2hash matches Strudel exactly, and the round trip is lossless', () => {
  for (const code of SONGS) {
    expect(code2hash(code)).toBe(strudelCode2hash(code));
    expect(hash2code(code2hash(code))).toBe(code);
    expect(strudelHash2code(code2hash(code))).toBe(code);
  }
});

test('a known value: s("bd") ↔ strudel.cc/#cygiYmQiKQ%3D%3D', () => {
  expect(strudelLink('s("bd")')).toBe('https://strudel.cc/#cygiYmQiKQ%3D%3D');
  expect(codeFromStrudelLink('https://strudel.cc/#cygiYmQiKQ%3D%3D')).toBe('s("bd")');
});

test('import accepts full links, bare hashes and surrounding whitespace', () => {
  for (const code of SONGS.filter(Boolean)) {
    expect(codeFromStrudelLink(`  ${strudelLink(code)}\n`)).toBe(code);
    expect(codeFromStrudelLink(`#${code2hash(code)}`)).toBe(code);
  }
});

test('import explains what is wrong with a bad link', () => {
  expect(() => codeFromStrudelLink('')).toThrow(ImportError);
  expect(() => codeFromStrudelLink('https://strudel.cc/?J01s5i1J0200')).toThrow(/short strudel\.cc link/);
  expect(() => codeFromStrudelLink('hello world')).toThrow(/does not look like/);
  expect(() => codeFromStrudelLink('https://strudel.cc/#%%%')).toThrow(/damaged/);
  expect(() => codeFromStrudelLink('https://strudel.cc/#')).toThrow(/no code/);
});

test('importName strips song extensions', () => {
  expect(importName('night drive.strudel.js')).toBe('night drive');
  expect(importName('beat.strudel')).toBe('beat');
  expect(importName('loop.js')).toBe('loop');
  expect(importName(undefined, new Date('2026-10-12T10:20:00Z'))).toBe('Imported 2026-10-12 10:20');
});
