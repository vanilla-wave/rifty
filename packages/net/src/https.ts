/**
 * `node:https` stub. TLS termination isn't available inside a browser tab —
 * the cross-origin-isolated playground would need WebTransport or a service-
 * worker tunnel to negotiate it, neither of which is in scope today.
 *
 * The module is registered so top-level imports (`import https from 'node:https'`)
 * succeed; any actual call throws `NotImplementedError` so the gap is loud.
 * That distinction matters because real packages (Vite, axios, node-fetch
 * polyfills) `import 'node:https'` defensively at the top of files they never
 * exercise on the browser dev path.
 */
import { NotImplementedError } from '@rifty/io';

function notImpl(method: string): never {
  throw new NotImplementedError(
    `node:https.${method}`,
    'TLS termination is not available in the browser — use http and rely on page TLS',
  );
}

const https = {
  createServer: (..._args: unknown[]) => notImpl('createServer'),
  request: (..._args: unknown[]) => notImpl('request'),
  get: (..._args: unknown[]) => notImpl('get'),
  Agent: class {
    constructor() {
      notImpl('Agent');
    }
  },
  globalAgent: new Proxy(
    {},
    {
      get(_t, p) {
        notImpl(`globalAgent.${String(p)}`);
      },
    },
  ),
  default: undefined as unknown,
};
(https as { default: unknown }).default = https;

export default https;
