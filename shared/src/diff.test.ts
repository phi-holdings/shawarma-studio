import { expect, test } from 'vitest';
import { hunks, mergeHunks } from './diff';

const before = 'a\nb\nc\nd\n';
const after = 'a\nB\nc\nD\nE\n';

test('hunks marks changed regions', () => {
  const h = hunks(before, after);
  expect(h.filter((x) => x.kind === 'change')).toHaveLength(2);
  expect(h[1]).toMatchObject({ kind: 'change', removed: 'b\n', added: 'B\n' });
});

test('mergeHunks applies only accepted changes', () => {
  const h = hunks(before, after);
  const ids = h.filter((x) => x.kind === 'change').map((x) => x.id);
  expect(mergeHunks(h, new Set([ids[0]]))).toBe('a\nB\nc\nd\n');
  expect(mergeHunks(h, new Set(ids))).toBe(after);
  expect(mergeHunks(h, new Set())).toBe(before);
});
