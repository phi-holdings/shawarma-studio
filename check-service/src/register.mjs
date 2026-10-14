import { register, registerHooks } from 'node:module';
import { redirect } from './node-resolve.mjs';

// Prefer in-thread hooks (Node ≥22.15): register() runs hooks on a worker thread, which the
// sandbox's permission model forbids.
if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier in redirect ? { url: redirect[specifier], shortCircuit: true } : nextResolve(specifier, context);
    },
  });
} else {
  register('./node-resolve.mjs', import.meta.url);
}
