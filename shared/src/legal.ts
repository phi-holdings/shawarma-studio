// The current versions of the Terms and the Privacy page (the date each last changed in a way that
// matters). Bump one together with its page in app/src/landing/; signed-in people who accepted an older
// version see a one-line notice in the app until they dismiss it (server: users.terms_version /
// users.privacy_version).
export const LEGAL_VERSIONS = { terms: '2026-10-16', privacy: '2026-10-16' } as const;

export type LegalPage = keyof typeof LEGAL_VERSIONS;

/** Which pages changed since the versions someone accepted (null: never recorded, i.e. before versions existed). */
export function legalChanges(accepted: { terms: string | null; privacy: string | null }): LegalPage[] {
  return (Object.keys(LEGAL_VERSIONS) as LegalPage[]).filter((k) => accepted[k] === null || accepted[k]! < LEGAL_VERSIONS[k]);
}
