import { soundCreditsFor } from '@shawarma/shared';
import { BUILD, STUDIO_REPO } from '../build';
import { DocPage, Mail, type DocPageProps } from './DocPage';

export { STUDIO_REPO };

export function Source({ links }: DocPageProps) {
  return (
    <DocPage title="Source code" updated="16 October 2026" links={links}>
      <p>The Shawarma editor you use in the browser, and the service that checks your songs, are free software under the GNU Affero General Public License, version 3 or later (AGPL-3.0). They are built on <a href="https://strudel.cc" rel="noreferrer">Strudel</a>, which uses the same licence.</p>

      <h2>Getting the source</h2>
      <p>The complete source of the editor and the song checker is public at <a href="https://github.com/phi-holdings/shawarma-studio" rel="noreferrer">github.com/phi-holdings/shawarma-studio</a>. You can browse it, download it, or clone it, at no charge and without an account. Each release of the site is built from that repository.</p>
      {BUILD.commit
        ? <p>The version running now is built from commit <a href={BUILD.sourceUrl} rel="noreferrer"><code>{BUILD.commit.slice(0, 12)}</code></a>{BUILD.dirty ? ', with changes not yet published there: write to us for an archive of them' : ''}.</p>
        : <p>The version running now is the newest one in <a href={BUILD.sourceUrl} rel="noreferrer">that repository</a>.</p>}
      <p>If you cannot reach GitHub, write to <Mail subject="Source code request" /> and we will send you an archive of the version currently running.</p>

      <h2>What is not part of it</h2>
      <p>Shawarma's assistant, sign-in and billing run on our own servers as a separate program. The editor talks to them over the network; they are not included in this source.</p>

      <h2>Sounds</h2>
      <p>The built-in sounds are recordings and instruments made by other people and shared under their own licences. Shawarma plays them from Strudel's sample library; the hosted editor offers these:</p>
      <ul>
        {soundCreditsFor('hosted').map((c) => (
          <li key={c.title}>
            <a href={c.sourceUrl} rel="noreferrer">{c.title}</a> by {c.author}, {c.licenceUrl ? <a href={c.licenceUrl} rel="noreferrer">{c.licence}</a> : c.licence}.
          </li>
        ))}
      </ul>
      <p>They are used unchanged.</p>

      <h2>What you can do with it</h2>
      <p>You can read it, run it, change it and share it. If you share a changed version, or let other people use it over a network, you must offer them its source under the same licence. The full text is in the <code>LICENSE</code> file that comes with the code and at <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noreferrer">gnu.org</a>.</p>
    </DocPage>
  );
}
