// The signed-out front page of hosted Shawarma: one screen, no scrolling. The promise and the one action on
// the left; on the right one panel showing the idea (a song you can point at), a Hairline figure per tab.
// Works without React too: the prerendered page runs the same tab and figure script (figures.ts).
import { useEffect } from 'react';
import { Mark } from '../brand/Mark';
import { Footer } from './DocPage';
import { defaultLinks, type LandingLinks } from './contact';
import './landing.css';

export interface LandingProps {
  /** Where "Continue with Google" goes (the server's /auth/google). */
  signInHref: string;
  /** Why the last sign-in failed, in plain words. */
  error?: string;
  links?: LandingLinks;
}

/** The showcase's tabs: a Hairline figure each, and something you could ask about that part. */
export const SHOWCASE = [
  { id: 'spit', tab: 'Layers', ask: 'bring the keys in after the first eight bars', text: 'A song is a stack of layers. Ask Shawarma to change any of them.' },
  { id: 'drum-machine', tab: 'Beat', ask: 'put a clap on two and four', text: 'Sixteen steps with a beat punched in. Ask for the pattern you hear.' },
  { id: 'mixing-desk', tab: 'Mix', ask: 'more bass, quieter pad', text: 'Eight channels and a master. Ask for the balance you want.' },
] as const;

export function Landing({ signInHref, error, links = defaultLinks }: LandingProps) {
  useEffect(() => {
    let undo: (() => void) | null = null;
    let gone = false;
    void import('./figures').then((m) => { if (!gone) undo = m.mountShowcase(document); });
    return () => { gone = true; undo?.(); };
  }, []);

  return (
    <div className="landing ld-home">
      <header className="ld-nav">
        <a className="ld-brand" href={links.home}><Mark size={26} />Shawarma</a>
        <nav aria-label="Account">
          <a className="ld-pill ld-pill-line" href={signInHref}>Sign in</a>
          <a className="ld-pill" href={signInHref}>Get started</a>
        </nav>
      </header>

      <main className="ld-main">
        <section className="ld-hero" aria-labelledby="ld-title">
          <div className="ld-hero-main">
            <h1 id="ld-title">Write songs in code. Change them by asking.</h1>
            <p className="ld-hero-side">
              A live-coding music editor for <a href="https://strudel.cc" rel="noreferrer">Strudel</a>. Your song loops while
              you type. Ask Shawarma for a change in plain words, listen to it, and keep only what you like.
            </p>
            {error && <p className="ld-error" role="alert">{error}</p>}
            <div className="ld-cta">
              <a className="ld-pill ld-pill-big" href={signInHref}>
                <GoogleMark />
                Continue with Google
              </a>
              <span className="ld-free">Free to start</span>
            </div>
          </div>
        </section>

        <section id="ld-show" className="ld-show" aria-label="What you can ask about">
          <div className="ld-tabs" role="tablist" aria-label="Parts of a song">
            {SHOWCASE.map((s, i) => (
              <button key={s.id} type="button" role="tab" id={`ld-tab-${s.id}`} aria-controls={`ld-panel-${s.id}`}
                aria-selected={i === 0} tabIndex={i === 0 ? 0 : -1} data-show-tab={s.id}>
                {s.tab}
              </button>
            ))}
          </div>
          {SHOWCASE.map((s, i) => (
            <div key={s.id} role="tabpanel" id={`ld-panel-${s.id}`} aria-labelledby={`ld-tab-${s.id}`} className="ld-panel" hidden={i !== 0} data-figure-card>
              <div className="ld-stage" data-figure={s.id} />
              <div className="ld-panel-foot">
                <p className="ld-ask"><span className="ld-you">You</span>{s.ask}</p>
                <p className="ld-panel-text">{s.text}</p>
                <output className="ld-read" data-figure-read>rest</output>
              </div>
            </div>
          ))}
        </section>
      </main>

      <Footer links={links} />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
