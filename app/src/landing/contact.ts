// Where people write for data requests, terms questions and source code requests.
// Set VITE_CONTACT_EMAIL at build time; the fallback must be a mailbox someone reads.
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL || 'shawarma@phi.holdings';

/** The landing page's own pages. The app routes them; the preview uses hashes. */
export interface LandingLinks { home: string; pricing: string; privacy: string; terms: string; source: string }
export const defaultLinks: LandingLinks = { home: '/', pricing: '/pricing', privacy: '/privacy', terms: '/terms', source: '/source' };
