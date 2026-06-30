/**
 * `node:https` — client `request`/`get` over the page's TLS-validated `fetch`
 * (ADR-0181), reusing the `node:http` client machinery with `protocol: 'https:'`
 * forced. The browser already performs validated TLS for external `https:` URLs
 * (the exact path `node:http` takes for external `https:` targets:
 * `routeClientRequest` → `{ kind: 'fetch' }` → `fetch` → `IncomingMessageFromFetch`),
 * so a plain `https.get('https://api…')` works without an in-realm TLS stack.
 *
 * The TLS *ceiling* from ADR-0010 stands: `createServer`, `new Agent()`, every
 * TLS/socket-control option, and loopback `https:` (no in-browser TLS server)
 * throw `NotImplementedError` — never a silent plaintext fallback or a silently
 * ignored option. Defensive top-level imports keep resolving.
 */
import { NotImplementedError } from '@riftydev/io';
import {
  type ClientRequest,
  type ClientResponse,
  type RequestOptions,
  get as httpGet,
  request as httpRequest,
  isLoopbackHost,
} from './http/server.ts';

type HttpsCallback = (res: ClientResponse) => void;

/**
 * `RequestOptions` plus the TLS/socket-control surface we explicitly refuse.
 * Typed as `unknown` because the values are never honoured — only their
 * presence is detected so the gap throws loudly.
 */
type HttpsRequestOptions = RequestOptions & {
  rejectUnauthorized?: boolean;
  cert?: unknown;
  key?: unknown;
  ca?: unknown;
  pfx?: unknown;
  passphrase?: unknown;
  ciphers?: unknown;
  secureProtocol?: unknown;
  servername?: unknown;
  agent?: unknown;
};

/**
 * `globalAgent` is a benign, READABLE config object (ADR-0181 D2). Libraries do
 * `if (https.globalAgent)` / read `agent.maxSockets`; those must not throw. It
 * controls no real socket pool — there is no socket layer behind it.
 */
const globalAgent = {
  maxSockets: Number.POSITIVE_INFINITY,
  maxFreeSockets: 256,
  maxTotalSockets: Number.POSITIVE_INFINITY,
  maxCachedSessions: 100,
  keepAlive: false,
  keepAliveMsecs: 1000,
  protocol: 'https:',
  defaultPort: 443,
};

// TLS/cert material that cannot be honoured in the browser — fetch performs its
// own validated TLS, so none of these can be applied (ADR-0181 D3).
const TLS_MATERIAL_OPTIONS = [
  'cert',
  'key',
  'ca',
  'pfx',
  'passphrase',
  'ciphers',
  'secureProtocol',
  'servername',
] as const;

function tlsCeiling(feature: string, hint: string): never {
  throw new NotImplementedError(`node:https.${feature}`, hint);
}

/**
 * Refuse any TLS/socket-control option on an options object. Each is named
 * individually so the thrown error points at the exact refused capability —
 * never silently honoured OR ignored (Fidelity; ADR-0181 D3).
 */
function guardTlsAndSocketOptions(opts: HttpsRequestOptions): void {
  for (const name of TLS_MATERIAL_OPTIONS) {
    if (opts[name] != null) {
      tlsCeiling(
        name,
        'TLS/cert controls cannot be honoured in the browser — fetch performs its own validated TLS, so custom certificate material/ciphers are not applied',
      );
    }
  }
  // `rejectUnauthorized: false` would disable certificate validation — the
  // browser cannot skip it, so refuse loudly rather than lie about security.
  // `rejectUnauthorized: true` IS the browser's behaviour, so it is honoured
  // (left to pass through), not ignored.
  if (opts.rejectUnauthorized === false) {
    tlsCeiling(
      'rejectUnauthorized',
      'the browser always validates TLS certificates — validation cannot be disabled',
    );
  }
  // A custom `Agent` instance configures a socket pool that does not exist here.
  // The benign `globalAgent` and `agent: false` (no pool) are allowed.
  const agent = opts.agent;
  if (agent != null && agent !== false && agent !== globalAgent) {
    tlsCeiling(
      'agent',
      'a custom https Agent controls a socket pool that does not exist in the browser runtime',
    );
  }
}

function hostWithoutPort(host: string): string {
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close === -1 ? host : host.slice(0, close + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * The host an `https` call would target. Mirrors how the http client resolves
 * a host (override > base hostname > base host > default localhost) so loopback
 * detection sees exactly what would be dispatched.
 */
function effectiveHost(
  urlOrOpts: string | HttpsRequestOptions,
  overrides?: RequestOptions,
): string {
  if (overrides?.hostname != null) return overrides.hostname;
  if (overrides?.host != null) return hostWithoutPort(overrides.host);
  if (typeof urlOrOpts === 'string') {
    try {
      return new URL(urlOrOpts).hostname;
    } catch {
      return 'localhost';
    }
  }
  if (urlOrOpts.hostname != null) return urlOrOpts.hostname;
  if (urlOrOpts.host != null) return hostWithoutPort(urlOrOpts.host);
  return 'localhost';
}

function guardLoopback(host: string): void {
  if (isLoopbackHost(host)) {
    tlsCeiling(
      'loopback',
      'loopback https targets have no in-browser TLS server — only external https: URLs route over the page fetch (pairs with ADR-0180 D4)',
    );
  }
}

function forceHttpsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = 'https:';
    return parsed.href;
  } catch {
    return url;
  }
}

type HttpClientImpl = (
  urlOrOpts: string | RequestOptions,
  optsOrCb?: RequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
) => ClientRequest;

/**
 * Shared `request`/`get` dispatch: refuse the TLS ceiling + loopback, then hand
 * off to the http client machinery with `protocol: 'https:'` forced.
 */
function dispatchHttps(
  impl: HttpClientImpl,
  urlOrOpts: string | HttpsRequestOptions,
  optsOrCb?: HttpsRequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
): ClientRequest {
  const overrides = typeof optsOrCb === 'object' && optsOrCb !== null ? optsOrCb : undefined;
  const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;

  if (typeof urlOrOpts === 'object' && urlOrOpts !== null) guardTlsAndSocketOptions(urlOrOpts);
  if (overrides) guardTlsAndSocketOptions(overrides);
  guardLoopback(effectiveHost(urlOrOpts, overrides));

  if (typeof urlOrOpts === 'string') {
    // With overrides, route through the http 3-arg merge with protocol forced.
    // Without, force the protocol on the URL itself so auth/fragment survive.
    return overrides
      ? impl(urlOrOpts, { ...overrides, protocol: 'https:' }, cb)
      : impl(forceHttpsUrl(urlOrOpts), cb);
  }
  return impl({ ...urlOrOpts, protocol: 'https:' }, cb);
}

export function request(
  urlOrOpts: string | HttpsRequestOptions,
  optsOrCb?: HttpsRequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
): ClientRequest {
  return dispatchHttps(httpRequest, urlOrOpts, optsOrCb, maybeCb);
}

export function get(
  urlOrOpts: string | HttpsRequestOptions,
  optsOrCb?: HttpsRequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
): ClientRequest {
  return dispatchHttps(httpGet, urlOrOpts, optsOrCb, maybeCb);
}

export function createServer(..._args: unknown[]): never {
  return tlsCeiling(
    'createServer',
    'TLS termination is not available in the browser — there is no in-browser HTTPS server (use http and rely on page TLS, or https.request/get for client calls)',
  );
}

export class Agent {
  constructor(..._args: unknown[]) {
    tlsCeiling(
      'Agent',
      'TLS termination is not available in the browser — a custom https Agent has no socket pool to manage',
    );
  }
}

const https = {
  request,
  get,
  createServer,
  Agent,
  globalAgent,
};

export { globalAgent };
export default https;
