import { expect, test } from 'vitest';
import type { InspectReport } from '@shawarma/shared';
import type { StoredChat } from '../api';
import { cardStatuses, errorItem, fromStoredChat, quickActions, settleProposal, upsertLive, usd, withSound } from './chatModel';

const p = (id: string) => ({ id, baseCode: 'a', code: 'b', summary: ['s'] });

test('stored chat: proposals keep their id (legacy ones get their position), the newest decision wins', () => {
  const chat: StoredChat[] = [
    { role: 'user', text: 'hi', selection: { from: 0, to: 2 }, scope: 'Line 1' },
    { role: 'assistant', text: 'ok' },
    { role: 'proposal', baseCode: 'a', code: 'b', summary: ['old'] },
    { role: 'proposal', ...p('p2') },
    { role: 'decision', proposalId: 'p2', status: 'rejected' },
    { role: 'decision', proposalId: 'p2', status: 'accepted', accepted: 1, total: 1 },
  ];
  const { items, decisions } = fromStoredChat(chat);
  expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'proposal', 'proposal']);
  expect(items[0]).toMatchObject({ scope: 'Line 1', selection: { from: 0, to: 2 } });
  expect(items[2]).toMatchObject({ proposal: { id: 'legacy-2' } });
  expect(decisions.get('p2')).toMatchObject({ status: 'accepted' });
});

test('only the newest undecided proposal is pending; older ones are superseded; live ones are live', () => {
  const items = [
    { kind: 'proposal' as const, proposal: p('a') },
    { kind: 'proposal' as const, proposal: p('b') },
    { kind: 'proposal' as const, proposal: p('c') },
  ];
  expect([...cardStatuses(items, new Map()).values()]).toEqual(['superseded', 'superseded', 'pending']);
  const decided = new Map([['c', { proposalId: 'c', status: 'accepted' as const }]]);
  expect([...cardStatuses(items, decided).values()]).toEqual(['superseded', 'superseded', 'accepted']);
  const withLive = upsertLive(items, p('d'));
  expect(cardStatuses(withLive, new Map()).get('d')).toBe('live');
  expect(cardStatuses(withLive, new Map()).get('c')).toBe('pending');
});

test('live proposals update in place and settle into one final card', () => {
  let items = upsertLive([], { ...p('x'), summary: ['one'] });
  items = upsertLive(items, { ...p('x'), summary: ['one', 'two'] });
  expect(items).toHaveLength(1);
  items = settleProposal(items, { ...p('x'), summary: ['one', 'two'], partial: true });
  expect(items).toEqual([{ kind: 'proposal', proposal: { ...p('x'), summary: ['one', 'two'], partial: true } }]);
});

test('quick actions follow the sections and the checks', () => {
  const report = (over: Partial<InspectReport>): InspectReport => ({
    ok: true, map: null, checkedCycles: 0, issues: [], sectionEventCounts: [], sounds: [], ...over,
  });
  expect(quickActions(null)).toEqual(['Vary the drums', 'Add a breakdown', 'Listen and tell me what\'s muddy']);
  const map = { cps: 0.5, totalCycles: 8, durationSec: 16, sections: [
    { index: 0, label: 'Intro', startCycle: 0, cycles: 4, startSec: 0, endSec: 8 },
    { index: 1, label: 'Verse 2', startCycle: 4, cycles: 4, startSec: 8, endSec: 16 },
  ] };
  expect(quickActions(report({ map }))).toContain('Add a breakdown after Verse 2');
  expect(quickActions(report({ issues: [{ kind: 'no_events', message: 'silent' }] }))[0]).toBe('Fix the check issues');
  expect(quickActions(report({ ok: false, error: 'x' }))[0]).toBe('Fix the check issues');
});

test('usd', () => {
  expect(usd(0.0123)).toBe('$0.012');
  expect(usd(1.5)).toBe('$1.50');
});

test('a section label made of code is named by its number; spend shows cents', () => {
  const map = { sections: [{ label: 'Intro' }, { label: 'stack(padLayer, drone, melody)' }] };
  expect(quickActions({ ok: true, issues: [], map } as unknown as InspectReport)).toContain('Add a breakdown after section 2');
  expect(usd(0)).toBe('$0.00');
});

test('sounds picked in the Sounds tab build up the message', () => {
  expect(withSound('', 's("bd")')).toBe('Add `s("bd")`');
  expect(withSound('Add `s("bd")`  ', 's("hh")')).toBe('Add `s("bd")` and `s("hh")`');
  expect(withSound('use a kick', 's("bd")')).toBe('use a kick and `s("bd")`');
});

test('a failed turn saved with the raw API error shows as a plain error, with a way to Settings for a bad key', () => {
  const raw = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';
  const { items } = fromStoredChat([{ role: 'user', text: 'hi' }, { role: 'assistant', text: `[error] ${raw}` }] as never);
  expect(items[1]).toEqual({ kind: 'error', text: "Anthropic didn't accept your API key. Check the key in Settings → Shawarma.", auth: true });
  expect(errorItem('The reply was cut off (max tokens).')).toEqual({ kind: 'error', text: 'The reply was cut off (max tokens).' });
});
