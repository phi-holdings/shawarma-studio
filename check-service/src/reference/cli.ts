// pnpm --filter @shawarma/check-service build-reference --strudel <path to a Strudel checkout>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReference, readCommit } from './build';

const args = process.argv.slice(2);
const at = args.indexOf('--strudel');
if (at < 0 || !args[at + 1]) { console.error('give the Strudel checkout with --strudel <path>'); process.exit(1); }
const strudel = path.resolve(args[at + 1]);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../reference/strudel-reference.json');
const commit = await readCommit(strudel);
const ref = await buildReference(strudel, commit);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(ref, null, 1)}\n`);
const n = (k: string) => ref.entries.filter((e) => e.kind === k).length;
console.log(`Strudel ${commit.slice(0, 12)}: ${n('function')} functions, ${n('doc')} doc sections -> ${path.relative(process.cwd(), out)}`);
