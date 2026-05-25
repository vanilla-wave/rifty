/**
 * Node-compatible `node:url` (subset). Modern Node code uses the global
 * `URL` (which we re-export) plus `URLSearchParams`. The legacy `parse`/`format`/
 * `resolve` functions are still used by older packages.
 */

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

/**
 * Legacy URL shape. `search`, `query`, and `hash` are `string | null` in
 * Node's deprecated parser — `null` when the input has no corresponding
 * component. `query` is the result of `querystring.parse` (an object) when
 * `parse(input, true)` is used, otherwise a string or `null`.
 */
export interface UrlObject {
  protocol?: string;
  slashes?: boolean;
  auth?: string;
  host?: string;
  hostname?: string;
  port?: string | number;
  pathname?: string;
  search?: string | null;
  query?: string | Record<string, unknown> | null;
  hash?: string | null;
  href?: string;
}

/**
 * Legacy `url.parse(urlString[, parseQueryString[, slashesDenoteHost]])`.
 *
 * Node semantics (deprecated but still widely used):
 *   - `parseQueryString=false` (default): `query` is the search string WITHOUT
 *     the leading `?` (e.g. `'a=1&b=2'`), or `null` when there is no query.
 *   - `parseQueryString=true`: `query` is the result of
 *     `querystring.parse(search.slice(1))` — an object — and is `{}` when
 *     there is no query.
 *
 * Previous implementation returned `undefined` for empty queries and a raw
 * string irrespective of the flag, which conflicts with Node's contract.
 *
 * `slashesDenoteHost` is accepted for parity but not yet honoured (no real
 * call site needs it). Add a NotImplementedError-throwing branch if a
 * concrete need shows up.
 */
export function parse(
  input: string,
  parseQueryString = false,
  _slashesDenoteHost = false,
): UrlObject {
  try {
    const u = new globalThis.URL(input);
    const searchRaw = u.search ? u.search.slice(1) : '';
    return {
      protocol: u.protocol,
      slashes: input.includes('//'),
      auth: u.username ? `${u.username}${u.password ? `:${u.password}` : ''}` : undefined,
      host: u.host,
      hostname: u.hostname,
      port: u.port || undefined,
      pathname: u.pathname,
      search: u.search || null,
      query: parseQueryString ? parseQueryToObject(searchRaw) : u.search ? searchRaw : null,
      hash: u.hash || null,
      href: u.href,
    };
  } catch {
    // Fall back to a partial parse for relative/path-only URLs.
    const match = /^([a-z][a-z0-9+.-]*:)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(input);
    if (!match) {
      return {
        href: input,
        pathname: input,
        search: null,
        query: parseQueryString ? {} : null,
        hash: null,
      };
    }
    const searchWithQ = match[4];
    const searchRaw = searchWithQ ? searchWithQ.slice(1) : '';
    return {
      protocol: match[1] || undefined,
      slashes: Boolean(match[2]),
      host: match[2]?.slice(2),
      pathname: match[3],
      search: searchWithQ ?? null,
      query: parseQueryString ? parseQueryToObject(searchRaw) : searchWithQ ? searchRaw : null,
      hash: match[5] ?? null,
      href: input,
    };
  }
}

/**
 * Minimal `querystring.parse` clone for `url.parse`'s `parseQueryString=true`
 * branch. Single values stay strings; repeated keys collect into arrays —
 * mirroring Node's `querystring` behaviour for the common cases.
 */
function parseQueryToObject(qs: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
    const key = decodeQueryComponent(rawKey);
    const val = decodeQueryComponent(rawVal);
    const existing = out[key];
    if (existing === undefined) {
      out[key] = val;
    } else if (Array.isArray(existing)) {
      existing.push(val);
    } else {
      out[key] = [existing, val];
    }
  }
  return out;
}

function decodeQueryComponent(s: string): string {
  // Node's querystring.parse replaces '+' with ' ' before decoding.
  const replaced = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(replaced);
  } catch {
    return replaced;
  }
}

export function format(o: UrlObject): string {
  if (o.href) return o.href;
  let out = '';
  if (o.protocol) out += o.protocol.endsWith(':') ? o.protocol : `${o.protocol}:`;
  if (o.slashes || o.host || o.hostname) out += '//';
  if (o.auth) out += `${o.auth}@`;
  if (o.host) out += o.host;
  else if (o.hostname) {
    out += o.hostname;
    if (o.port) out += `:${o.port}`;
  }
  if (o.pathname) out += o.pathname;
  if (o.search) out += o.search.startsWith('?') ? o.search : `?${o.search}`;
  else if (typeof o.query === 'string' && o.query) out += `?${o.query}`;
  if (o.hash) out += o.hash.startsWith('#') ? o.hash : `#${o.hash}`;
  return out;
}

export function resolve(from: string, to: string): string {
  try {
    return new globalThis.URL(to, from).href;
  } catch {
    return to;
  }
}

export function pathToFileURL(p: string): URL {
  const abs = p.startsWith('/') ? p : `/${p}`;
  return new globalThis.URL(`file://${abs}`);
}

export function fileURLToPath(u: URL | string): string {
  const url = typeof u === 'string' ? new globalThis.URL(u) : u;
  if (url.protocol !== 'file:') throw new TypeError('Expected file: URL');
  return decodeURIComponent(url.pathname);
}

const url = {
  URL,
  URLSearchParams,
  parse,
  format,
  resolve,
  pathToFileURL,
  fileURLToPath,
};
export default url;
