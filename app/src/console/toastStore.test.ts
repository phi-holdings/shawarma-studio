import { expect, test } from 'vitest';
import { createToastStore, toastMs } from './toastStore';

test('one toast at a time; dismissing an older one leaves the newer', () => {
  const s = createToastStore();
  s.show('');
  expect(s.get()).toBeNull();
  s.show('Saved v1');
  const first = s.get()!;
  s.show('Export failed: disk full', 'error');
  s.dismiss(first.id);
  expect(s.get()).toMatchObject({ message: 'Export failed: disk full', kind: 'error' });
  s.dismiss(s.get()!.id);
  expect(s.get()).toBeNull();
});

test('reading time grows with the message, errors stay longer, capped', () => {
  expect(toastMs({ id: 1, message: 'Saved', kind: 'notice' })).toBe(4000);
  expect(toastMs({ id: 1, message: 'x', kind: 'error' })).toBe(7000);
  expect(toastMs({ id: 1, message: 'x'.repeat(1000), kind: 'notice' })).toBe(12_000);
});
