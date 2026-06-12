type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface NpmRegistryProxyOptions {
  readonly upstreamBase?: string;
}

interface ProcessEnvGlobal {
  readonly process?: {
    readonly env?: Record<string, string | undefined>;
  };
}

declare const Netlify:
  | {
      readonly env: {
        get(name: string): string | undefined;
      };
    }
  | undefined;

const UPSTREAM_ENV = 'RIFTY_NPM_REGISTRY_UPSTREAM';
const ROUTE_PREFIX = '/npm-registry';
const DIRECT_FUNCTION_PREFIX = '/.netlify/functions/npm-registry';
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

function envUpstream(): string | undefined {
  const netlifyEnv = typeof Netlify === 'undefined' ? undefined : Netlify.env.get(UPSTREAM_ENV);
  const processEnv = (globalThis as typeof globalThis & ProcessEnvGlobal).process?.env?.[
    UPSTREAM_ENV
  ];
  return netlifyEnv ?? processEnv;
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
  for (const prefix of [ROUTE_PREFIX, DIRECT_FUNCTION_PREFIX]) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return null;
}

function upstreamUrl(request: Request, upstreamBase: string): string | null {
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
  options: NpmRegistryProxyOptions = {},
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

  const upstreamBase = options.upstreamBase ?? envUpstream();
  if (upstreamBase === undefined || upstreamBase.length === 0) {
    return new Response(`Missing ${UPSTREAM_ENV}`, { status: 500, headers: corsHeaders() });
  }

  let target: string | null;
  try {
    target = upstreamUrl(request, upstreamBase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Invalid ${UPSTREAM_ENV}: ${message}`, {
      status: 500,
      headers: corsHeaders(),
    });
  }

  if (target === null) {
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  }

  const upstream = await fetcher(target, { method: request.method });
  const body = request.method === 'HEAD' ? null : await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: withCors(upstream.headers),
  });
}

export default async function npmRegistryProxy(request: Request): Promise<Response> {
  return handleNpmRegistryRequest(request);
}

export const config = {
  path: ['/npm-registry', '/npm-registry/*'],
};
