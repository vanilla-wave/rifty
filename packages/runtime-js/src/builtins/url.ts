/**
 * Node-compatible `node:url` (subset). Modern Node code uses the global
 * `URL` (which we re-export) plus `URLSearchParams`. The legacy `parse`/`format`/
 * `resolve` functions are still used by older packages.
 */

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

export interface UrlObject {
  protocol?: string;
  slashes?: boolean;
  auth?: string;
  host?: string;
  hostname?: string;
  port?: string | number;
  pathname?: string;
  search?: string;
  query?: string | Record<string, unknown>;
  hash?: string;
  href?: string;
}

export function parse(input: string): UrlObject {
  try {
    const u = new globalThis.URL(input);
    return {
      protocol: u.protocol,
      slashes: input.includes('//'),
      auth: u.username ? `${u.username}${u.password ? `:${u.password}` : ''}` : undefined,
      host: u.host,
      hostname: u.hostname,
      port: u.port || undefined,
      pathname: u.pathname,
      search: u.search || undefined,
      query: u.search ? u.search.slice(1) : undefined,
      hash: u.hash || undefined,
      href: u.href,
    };
  } catch {
    // Fall back to a partial parse for relative/path-only URLs.
    const match = /^([a-z][a-z0-9+.-]*:)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(input);
    if (!match) return { href: input, pathname: input };
    return {
      protocol: match[1] || undefined,
      slashes: Boolean(match[2]),
      host: match[2]?.slice(2),
      pathname: match[3],
      search: match[4],
      hash: match[5],
      href: input,
    };
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
