// The public site's only client entry: styles, the desk theme's two fonts, and the sign-in error line.
// No React, no CodeMirror, no Strudel: the pages arrive prerendered (scripts/prerender.mjs).
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../app.css';
import '../landing/landing.css';
import './site.css';
import { showSignInError } from './signInError';

showSignInError(document, location.search);
// the showcase's tabs and Hairline figures load after the page is shown
void import('../landing/figures').then((m) => m.mountShowcase(document));
