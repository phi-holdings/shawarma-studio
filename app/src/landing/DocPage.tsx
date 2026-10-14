// The shared frame for the short pages linked from the landing footer (privacy, terms, source code).
import type { ReactNode } from 'react';
import { Mark } from '../brand/Mark';
import { CONTACT_EMAIL, defaultLinks, type LandingLinks } from './contact';
import './landing.css';

export interface DocPageProps { links?: LandingLinks }

export function Footer({ links }: { links: LandingLinks }) {
  return (
    <footer className="ld-foot">
      <span className="wordmark"><Mark size={20} weight={2.8} />Shawarma</span>
      <nav aria-label="About Shawarma">
        <a href={links.privacy}>Privacy</a>
        <a href={links.terms}>Terms</a>
        <a href={links.source}>Source code</a>
      </nav>
      <span className="ld-license">Free software under the AGPL-3.0</span>
    </footer>
  );
}

export function DocPage({ title, updated, links = defaultLinks, children }: { title: string; updated: string; links?: LandingLinks; children: ReactNode }) {
  return (
    <div className="landing">
      <article className="ld-doc">
        <header className="ld-doc-head">
          <a className="wordmark" href={links.home}><Mark size={26} />Shawarma</a>
          <a href={links.home}>Back to the front page</a>
        </header>
        <h1>{title}</h1>
        <p className="ld-updated">Last updated {updated}</p>
        {children}
      </article>
      <Footer links={links} />
    </div>
  );
}

export function Mail({ subject }: { subject?: string }) {
  const href = `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return <a href={href}>{CONTACT_EMAIL}</a>;
}
