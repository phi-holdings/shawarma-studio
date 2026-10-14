import { DocPage, Mail, type DocPageProps } from './DocPage';

export function Source({ links }: DocPageProps) {
  return (
    <DocPage title="Source code" updated="13 October 2026" links={links}>
      <p>Shawarma REPL is free software, licensed under the GNU Affero General Public License, version 3 or later (AGPL-3.0). It is built on <a href="https://strudel.cc" rel="noreferrer">Strudel</a>, which uses the same licence.</p>

      <h2>Getting the source</h2>
      <p>The code lives in a private repository, so there is no public download link. Because you use Shawarma over the network, the AGPL gives you the right to the complete source code of the version we run, and we will send it to you.</p>
      <p>Write to <Mail subject="Source code request" /> and say that you want the source. You do not need an account and do not need to give a reason. We will reply with a copy of the source for the version currently running, as an archive or as access to the repository, at no charge.</p>

      <h2>What you can do with it</h2>
      <p>You can read it, run it, change it and share it. If you share a changed version, or let other people use it over a network, you must offer them its source under the same licence. The full text is in the <code>LICENSE</code> file that comes with the code and at <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noreferrer">gnu.org</a>.</p>
    </DocPage>
  );
}
