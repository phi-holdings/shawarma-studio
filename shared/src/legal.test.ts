import { expect, test } from 'vitest';
import { LEGAL_VERSIONS, legalChanges } from './legal';

test('a page counts as changed when its accepted version is older or missing', () => {
  expect(legalChanges({ terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy })).toEqual([]);
  expect(legalChanges({ terms: '2000-01-01', privacy: LEGAL_VERSIONS.privacy })).toEqual(['terms']);
  expect(legalChanges({ terms: null, privacy: null })).toEqual(['terms', 'privacy']);
});

test('versions are ISO dates, so they compare as strings', () => {
  for (const v of Object.values(LEGAL_VERSIONS)) expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
