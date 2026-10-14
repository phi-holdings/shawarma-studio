// Standalone preview of the signed-out pages, without the server: /landing-preview.html.
// #privacy, #terms and #source show those pages; ?theme=paper|night picks a theme.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../app.css';
import type { LandingLinks } from './contact';
import { Landing } from './Landing';
import { Privacy } from './Privacy';
import { Source } from './Source';
import { Terms } from './Terms';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') ?? 'desk';
const links: LandingLinks = { home: '#', privacy: '#privacy', terms: '#terms', source: '#source' };

function Preview() {
  const [page, setPage] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setPage(location.hash.slice(1));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  if (page === 'privacy') return <Privacy links={links} />;
  if (page === 'terms') return <Terms links={links} />;
  if (page === 'source') return <Source links={links} />;
  return <Landing signInHref="#" error={params.get('error') ?? undefined} links={links} />;
}

createRoot(document.getElementById('root')!).render(<Preview />);
