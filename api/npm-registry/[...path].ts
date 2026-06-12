export const config = { runtime: 'edge' };

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_UPSTREAM = 'https://registry.npmjs.org';
const ROUTE_PREFIXES = ['/npm-registry', '/api/npm-registry'] as const;
const UNSAFE_RESPONSE_HEADERS = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

function envUpstream(): string {
  if (typeof process === 'undefined') return DEFAULT_UPSTREAM;
  const value = process.env.RIFTY_NPM_REGISTRY_UPSTREAM;
  return value && value.length > 0 ? value : DEFAULT_UPSTREAM;
}

function corsHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'accept, content-type',
    'cross-origin-resource-policy': 'cross-origin',
  });
}

function withCors(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const key of UNSAFE_RESPONSE_HEADERS) out.delete(key);
  for (const [key, value] of corsHeaders()) out.set(key, value);
  return out;
}

function routeSuffix(pathname: string): string | null {
  for (const prefix of ROUTE_PREFIXES) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return null;
}

function upstreamUrl(request: Request, upstreamBase = envUpstream()): string | null {
  const incoming = new URL(request.url);
  const suffix = routeSuffix(incoming.pathname);
  if (suffix === null) return null;

  const upstream = new URL(upstreamBase);
  const basePath = upstream.pathname.replace(/\/$/, '');
  upstream.pathname = `${basePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  upstream.search = incoming.search;
  return upstream.toString();
}

export async function handleNpmRegistryRequest(
  request: Request,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const headers = corsHeaders();
    headers.set('allow', 'GET, HEAD, OPTIONS');
    return new Response('Method Not Allowed', { status: 405, headers });
  }

  const target = upstreamUrl(request);
  if (target === null) {
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  }

  const upstream = await fetcher(target, { method: request.method });
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: withCors(upstream.headers),
  });
}

export default handleNpmRegistryRequest;
