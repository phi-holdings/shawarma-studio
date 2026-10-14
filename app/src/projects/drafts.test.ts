import { expect, test } from 'vitest';
import { clearDraft, draftTime, loadDraft, syncDraft } from './drafts';

/** In-memory Storage stand-in (the unit tests run in Node). */
function memory(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

test('a draft is kept while the buffer differs from the saved code, and dropped when it matches', () => {
  const storage = memory();
  const now = new Date('2026-10-12T10:00:00Z');
  syncDraft('p', 's("bd sd")', 's("bd")', { storage, now });
  expect(loadDraft('p', 's("bd")', storage)).toEqual({ code: 's("bd sd")', at: now.toISOString() });
  expect(loadDraft('other', 's("bd")', storage)).toBeNull();
  // saved elsewhere meanwhile: a draft equal to the saved code is not offered
  expect(loadDraft('p', 's("bd sd")', storage)).toBeNull();
  syncDraft('p', 's("bd")', 's("bd")', { storage });
  expect(storage.map.size).toBe(0);
});

test('keepWhenClean leaves an offered draft alone; clearDraft removes it', () => {
  const storage = memory();
  syncDraft('p', 'edited', 'saved', { storage });
  syncDraft('p', 'saved', 'saved', { storage, keepWhenClean: true });
  expect(loadDraft('p', 'saved', storage)?.code).toBe('edited');
  clearDraft('p', storage);
  expect(loadDraft('p', 'saved', storage)).toBeNull();
});

test('corrupt entries and storage errors are ignored', () => {
  const storage = memory();
  storage.setItem('shawarma.draft.p', '{not json');
  expect(loadDraft('p', 'x', storage)).toBeNull();
  storage.setItem('shawarma.draft.p', JSON.stringify({ code: 5 }));
  expect(loadDraft('p', 'x', storage)).toBeNull();
  const full = { ...memory(), setItem: () => { throw new Error('QuotaExceededError'); } } as Storage;
  expect(() => syncDraft('p', 'a', 'b', { storage: full })).not.toThrow();
});

test('draftTime reads naturally', () => {
  const now = new Date(2026, 9, 12, 15, 0);
  expect(draftTime(new Date(2026, 9, 12, 14, 5).toISOString(), now)).toMatch(/^today at /);
  expect(draftTime(new Date(2026, 9, 11, 9, 12).toISOString(), now)).toMatch(/^yesterday at /);
  expect(draftTime('nope', now)).toBe('earlier');
});
