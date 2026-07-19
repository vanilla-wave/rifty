const ESBUILD_VERSION = '0.28.0';

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function registryPackumentUrl(value) {
  let registry;
  try {
    registry = new URL(value);
  } catch {
    throw new TypeError('selection oracle registry must be an absolute http(s) URL');
  }
  if (
    (registry.protocol !== 'http:' && registry.protocol !== 'https:') ||
    registry.username !== '' ||
    registry.password !== '' ||
    registry.search !== '' ||
    registry.hash !== ''
  ) {
    throw new TypeError('selection oracle registry must be an absolute http(s) URL');
  }
  return `${registry.href.replace(/\/+$/u, '')}/esbuild`;
}

function exactEsbuildVersion(packument) {
  if (packument.name !== 'esbuild') {
    throw new TypeError(`public esbuild@${ESBUILD_VERSION} packument identity drifted`);
  }
  const versions = record(packument.versions, 'public esbuild versions');
  const exact = record(versions[ESBUILD_VERSION], `public esbuild@${ESBUILD_VERSION}`);
  if (exact.name !== 'esbuild' || exact.version !== ESBUILD_VERSION) {
    throw new TypeError(`public esbuild@${ESBUILD_VERSION} metadata drifted`);
  }
  const dist = record(exact.dist, `public esbuild@${ESBUILD_VERSION} dist`);
  let tarball;
  try {
    tarball = new URL(dist.tarball);
  } catch {
    throw new TypeError(`public esbuild@${ESBUILD_VERSION} provenance drifted`);
  }
  if (
    (tarball.protocol !== 'http:' && tarball.protocol !== 'https:') ||
    !tarball.pathname.endsWith(`/esbuild-${ESBUILD_VERSION}.tgz`) ||
    typeof dist.integrity !== 'string' ||
    !dist.integrity.startsWith('sha512-') ||
    dist.integrity.length <= 'sha512-'.length
  ) {
    throw new TypeError(`public esbuild@${ESBUILD_VERSION} provenance drifted`);
  }
  return exact;
}

/** Preserve npm-proven exact metadata while removing moving unsupported selections. */
export function pinnedEsbuild0280Packument(input) {
  const packument = record(input, 'public esbuild packument');
  const exact = exactEsbuildVersion(packument);
  const tags = record(packument['dist-tags'], 'public esbuild dist-tags');
  return {
    ...packument,
    'dist-tags': { ...tags, latest: ESBUILD_VERSION },
    versions: { [ESBUILD_VERSION]: exact },
  };
}

function routePort(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.request !== 'function' ||
    typeof value.fetch !== 'function' ||
    typeof value.fulfill !== 'function'
  ) {
    throw new TypeError('selection oracle received an invalid Playwright route');
  }
  return value;
}

/** Install one real-upstream finite selection oracle in a fresh browser context. */
export async function installEsbuild0280SelectionOracle(context, registryUrl) {
  if (context === null || typeof context !== 'object' || typeof context.route !== 'function') {
    throw new TypeError('selection oracle requires a Playwright browser context');
  }
  const packumentUrl = registryPackumentUrl(registryUrl);
  let requests = 0;
  await context.route(packumentUrl, async (inputRoute) => {
    requests += 1;
    const route = routePort(inputRoute);
    const request = route.request();
    if (request === null || typeof request !== 'object' || typeof request.method !== 'function') {
      throw new TypeError('selection oracle route request is invalid');
    }
    const method = request.method();
    if (method !== 'GET') {
      throw new Error(`selection oracle expected GET, received ${String(method)}`);
    }
    const response = await route.fetch();
    if (
      response === null ||
      typeof response !== 'object' ||
      typeof response.ok !== 'function' ||
      typeof response.status !== 'function' ||
      typeof response.json !== 'function'
    ) {
      throw new TypeError('selection oracle upstream response is invalid');
    }
    if (!response.ok()) {
      throw new Error(`public esbuild packument failed with HTTP ${String(response.status())}`);
    }
    const json = pinnedEsbuild0280Packument(await response.json());
    await route.fulfill({ response, json });
  });

  return Object.freeze({
    assertUsed() {
      if (requests !== 1) {
        throw new Error(
          `finite esbuild selection oracle must be used exactly once; saw ${requests}`,
        );
      }
      return Object.freeze({ requests });
    },
  });
}
