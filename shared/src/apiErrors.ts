// Errors from the Anthropic API arrive as the SDK's message, e.g. `401 {"type":"error","error":{...}}`.
// These are turned into one plain sentence that says what happened and what to do; anything else
// passes through unchanged (so this is safe to run twice, and on text that is already friendly).

export interface FriendlyError {
  message: string;
  /** The API key was refused: the UI offers a way to Settings. */
  auth?: boolean;
}

const KEY_HELP = 'Check the key in Settings → Shawarma.';

export function friendlyApiError(raw: string): FriendlyError {
  const text = raw.trim();
  if (/^(Connection error|Request timed out|fetch failed)/i.test(text)) {
    return { message: "Couldn't reach Anthropic. Check your internet connection, then send again." };
  }
  const m = /^(\d{3})\b\s*(.*)$/s.exec(text);
  if (!m) return { message: raw };
  const status = Number(m[1]);
  let type = '';
  let detail = '';
  try {
    const body = JSON.parse(m[2]) as { error?: { type?: string; message?: string } };
    type = body.error?.type ?? '';
    detail = body.error?.message ?? '';
  } catch {
    if (status < 400) return { message: raw };
    detail = m[2];
  }
  if (status === 401 || type === 'authentication_error') return { message: `Anthropic didn't accept your API key. ${KEY_HELP}`, auth: true };
  if (status === 403 || type === 'permission_error') return { message: `Your Anthropic API key isn't allowed to do this. ${KEY_HELP}`, auth: true };
  if (/credit balance/i.test(detail)) return { message: 'Your Anthropic account is out of credit. Add credit in the Anthropic console, then send again.' };
  if (status === 429 || type === 'rate_limit_error') return { message: 'Anthropic is limiting requests right now. Wait a minute, then send again.' };
  if (status === 529 || type === 'overloaded_error') return { message: 'Anthropic is busy right now. Send again in a moment.' };
  if (status === 413 || type === 'request_too_large') return { message: 'This chat and song are too long for one request. Start a new project chat or shorten the code.' };
  if (status >= 500 || type === 'api_error') return { message: 'Anthropic had a problem on its side. Send again in a moment.' };
  return { message: detail ? `Anthropic refused the request: ${detail}` : 'Anthropic refused the request. Send again, or rephrase it.' };
}
