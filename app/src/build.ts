// Which build of the editor this is (vite.config.ts sets these at build time): the /source page links
// the exact commit, and Help & feedback mentions it.
export const STUDIO_REPO = 'https://github.com/phi-holdings/shawarma-studio';

const commit: string = (import.meta.env.VITE_STUDIO_COMMIT ?? '').trim();
const dirty = import.meta.env.VITE_STUDIO_DIRTY === '1';

export const BUILD = {
  /** Full commit hash, or '' when unknown. */
  commit: /^[0-9a-f]{7,40}$/i.test(commit) ? commit : '',
  dirty,
  /** "0.1.0+a1b2c3d" (plus "-dirty"), for support mails. */
  get id(): string { return `0.1.0${this.commit ? `+${this.commit.slice(0, 7)}${dirty ? '-dirty' : ''}` : ''}`; },
  /** The source of this build on GitHub: the commit's tree, else the repo's front page. */
  get sourceUrl(): string { return this.commit ? `${STUDIO_REPO}/tree/${this.commit}` : STUDIO_REPO; },
};
