import { expect, test } from 'vitest';
import { smartInsert } from './Editor';

test('a whole expression gets its own line; chains and selections go at the cursor', () => {
  expect(smartInsert('note("c3")', 0, 0, 's("bd")')).toEqual({ from: 10, to: 10, insert: '\ns("bd")' });
  expect(smartInsert('a\n\nb', 2, 2, 's("bd")')).toEqual({ from: 2, to: 2, insert: 's("bd")' });
  expect(smartInsert('s("bd")', 7, 7, '.bank("RolandTR808")')).toEqual({ from: 7, to: 7, insert: '.bank("RolandTR808")' });
  expect(smartInsert('s("x")', 3, 4, 'y')).toEqual({ from: 3, to: 4, insert: 'y' });
});
