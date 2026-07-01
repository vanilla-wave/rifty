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
  buildRequestUrl,
  get as httpGet,
  request as httpRequest,
  isLoopbackHost,
  optionsFromUrl,
} from './http/server.ts';

type HttpsCallback = (res: ClientResponse) => void;
type HttpsUrlInput = string | URL;

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

/**
 * Refuse a dispatch URL whose host canonicalises to loopback. Parsing with
 * `new URL()` mirrors `routeClientRequest` exactly, so non-canonical IPv4
 * (`2130706433`, `127.1`, `0177.0.0.1`) and compressed/bracketed IPv6 reach the
 * SAME loopback verdict the http client uses — never leaking to the real
 * loopback, never falsely refusing an external host (the guard sees the exact
 * URL that would be dispatched, built by `buildRequestUrl`).
 */
function guardLoopback(dispatchUrl: string): void {
  let host: string;
  try {
    host = new URL(dispatchUrl).hostname;
  } catch {
    return; // unparseable target — fetch will surface its own error, not ours
  }
  if (isLoopbackHost(host)) {
    tlsCeiling(
      'loopback',
      'loopback https targets have no in-browser TLS server — only external https: URLs route over the page fetch (pairs with ADR-0180 D4)',
    );
  }
}

function invalidProtocolError(protocol: string): TypeError & { code: string } {
  return Object.assign(new TypeError(`Protocol "${protocol}" not supported. Expected "https:"`), {
    code: 'ERR_INVALID_PROTOCOL',
  });
}

function validateHttpsUrl(url: HttpsUrlInput): string {
  try {
    const parsed = url instanceof URL ? url : new URL(url);
    if (parsed.protocol !== 'https:') throw invalidProtocolError(parsed.protocol);
    return parsed.href;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'ERR_INVALID_PROTOCOL'
    ) {
      throw err;
    }
    if (url instanceof URL) throw invalidProtocolError(url.protocol);
    return url;
  }
}

type HttpClientImpl = (
  urlOrOpts: HttpsUrlInput | RequestOptions,
  optsOrCb?: RequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
) => ClientRequest;

/**
 * Shared `request`/`get` dispatch: refuse the TLS ceiling + loopback, then hand
 * off to the http client machinery with `protocol: 'https:'` forced.
 */
function dispatchHttps(
  impl: HttpClientImpl,
  urlOrOpts: HttpsUrlInput | HttpsRequestOptions,
  optsOrCb?: HttpsRequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
): ClientRequest {
  const overrides = typeof optsOrCb === 'object' && optsOrCb !== null ? optsOrCb : undefined;
  const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;

  if (typeof urlOrOpts === 'object' && urlOrOpts !== null && !(urlOrOpts instanceof URL)) {
    guardTlsAndSocketOptions(urlOrOpts);
  }
  if (overrides) guardTlsAndSocketOptions(overrides);

  // Build the EXACT url the http client will dispatch, refuse it if it
  // canonicalises to loopback, then hand off with `protocol: 'https:'` forced.
  if (typeof urlOrOpts === 'string' || urlOrOpts instanceof URL) {
    const url = validateHttpsUrl(urlOrOpts);
    if (overrides) {
      const forced = { ...overrides, protocol: 'https:' };
      guardLoopback(buildRequestUrl({ ...optionsFromUrl(url), ...forced }));
      return impl(url, forced, cb);
    }
    guardLoopback(url);
    return impl(url, cb);
  }
  const forced = { ...urlOrOpts, protocol: 'https:' };
  guardLoopback(buildRequestUrl(forced));
  return impl(forced, cb);
}

export function request(
  urlOrOpts: HttpsUrlInput | HttpsRequestOptions,
  optsOrCb?: HttpsRequestOptions | HttpsCallback,
  maybeCb?: HttpsCallback,
): ClientRequest {
  return dispatchHttps(httpRequest, urlOrOpts, optsOrCb, maybeCb);
}

export function get(
  urlOrOpts: HttpsUrlInput | HttpsRequestOptions,
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
