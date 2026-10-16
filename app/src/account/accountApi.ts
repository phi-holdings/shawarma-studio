// The Account page's calls (server/src/http/account.ts).
import { failure, OfflineError } from '../api';

async function call(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new OfflineError(); }
  if (!res.ok) throw await failure(res);
  return res;
}
const post = (url: string, body: unknown = {}) => call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Downloads everything as one JSON file (the browser saves it). */
export async function exportMyData(save: (blob: Blob, name: string) => void = saveBlob): Promise<void> {
  const res = await call('/api/account/export');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'shawarma-data.json';
  save(await res.blob(), name);
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Deletes the account for good; `confirm` is the email typed by the person. */
export const deleteMyAccount = (confirm: string) => post('/api/account/delete', { confirm }).then(() => undefined);
export const signOutEverywhere = () => post('/api/account/sign-out-everywhere').then(() => undefined);
/** Records that the updated Terms/Privacy notice was seen. */
export const acknowledgeLegal = () => post('/api/account/legal').then(() => undefined);
