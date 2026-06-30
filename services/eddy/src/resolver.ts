/**
 * Eddy resolution engine (ADR-0182 §2): run rifty's OWN `install()` into an
 * in-memory VFS, harvest the lockfile + the compressed tarballs it cached, and
 * pack them into one `EddyBundleV1`. ONE algorithm — eddy IMPORTS
 * `@riftydev/npm-client`, never reimplements — so the bundle's lockfile equals a
 * client live-resolve by construction, and the ADR-0051 native gate + the
 * non-registry-spec loud-throws ride for free (caught here → typed decline).
 */
import {
  EDDY_BUNDLE_FORMAT,
  type EddyBundleManifestV1,
  type EddyBundleTarballEntry,
  type Fetcher,
  RegistryClient,
  VfsTarballCache,
  install,
  packEddyBundle,
} from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { closureHashOf } from './closure-hash.ts';
import { readNpmClientVersion } from './npm-client-version.ts';

/** A dep-set to resolve (the shapes `package.json` carries). */
export interface EddyResolveRequest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  /** `'online'` forces a fresh recompute server-side (npm `--prefer-online`). */
  prefer?: 'cached' | 'online';
}

export interface EddyResolverDeps {
  /** Upstream registry base URL (D-004 env-config at the server boundary). */
  registryBaseUrl: string;
  /** Injectable fetch (tests pass a fixture registry; prod uses Node fetch). */
  fetch?: Fetcher;
  /** Injectable resolution timestamp (tests pin it). */
  now?: () => string;
}

export type EddyResolveResult =
  | { kind: 'bundle'; bytes: Uint8Array; manifest: EddyBundleManifestV1 }
  | { kind: 'unsupported'; feature: string; message: string };

const ROOT = '/work';

export async function resolveBundle(
  req: EddyResolveRequest,
  deps: EddyResolverDeps,
): Promise<EddyResolveResult> {
  const { vfs } = createMemoryFs();
  await vfs.mkdir(ROOT, { recursive: true });
  const pkgJson: Record<string, unknown> = { name: 'eddy-root', version: '0.0.0' };
  if (req.dependencies) pkgJson.dependencies = req.dependencies;
  if (req.devDependencies) pkgJson.devDependencies = req.devDependencies;
  if (req.optionalDependencies) pkgJson.optionalDependencies = req.optionalDependencies;
  if (req.overrides) pkgJson.overrides = req.overrides;
  await vfs.writeFile(`${ROOT}/package.json`, JSON.stringify(pkgJson));

  const tarballCache = new VfsTarballCache(vfs);
  const registry = new RegistryClient({ baseUrl: deps.registryBaseUrl, fetch: deps.fetch });

  let result: Awaited<ReturnType<typeof install>>;
  try {
    result = await install({ vfs, cwd: ROOT, registry, tarballCache });
  } catch (err) {
    return declineFor(err);
  }

  // One tarball per unique (name@version); harvest the original gzip bytes the
  // installer cached, keyed by the integrity it verified them under.
  const seen = new Set<string>();
  const entries: EddyBundleTarballEntry[] = [];
  const tarballs: Array<{ entry: EddyBundleTarballEntry; bytes: Uint8Array }> = [];
  for (const pkg of result.packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const integrity = (pkg as { integrity?: string }).integrity;
    if (!integrity) {
      return {
        kind: 'unsupported',
        feature: 'integrity-missing',
        message: `no integrity for ${key}`,
      };
    }
    const bytes = await tarballCache.get(pkg.name, pkg.version, integrity);
    if (!bytes) {
      return {
        kind: 'unsupported',
        feature: 'tarball-missing',
        message: `tarball absent from cache for ${key}`,
      };
    }
    const file = `tarballs/${pkg.name.replace(/\//g, '__')}-${pkg.version}.tgz`;
    const entry: EddyBundleTarballEntry = { file, name: pkg.name, version: pkg.version, integrity };
    entries.push(entry);
    tarballs.push({ entry, bytes });
  }

  const manifest: EddyBundleManifestV1 = {
    format: EDDY_BUNDLE_FORMAT,
    npmClientVersion: readNpmClientVersion(),
    asOf: {
      resolvedAt: deps.now ? deps.now() : new Date().toISOString(),
      registry: deps.registryBaseUrl,
      closureHash: closureHashOf(result.lockfile),
    },
    tarballs: entries,
  };
  const bytes = packEddyBundle({
    manifest,
    lockfileText: JSON.stringify(result.lockfile, null, 2),
    tarballs,
  });
  return { kind: 'bundle', bytes, manifest };
}

/** Map a resolution failure to a typed decline (client falls back to standard,
 * which re-throws the same loud error). NEVER synthesize a result. eddy treats
 * `install()` as a black box throwing coded errors — `NotImplementedError`
 * (non-registry specs / lifecycle, detected by its stable `.name`/`.feature`
 * contract) and `ENATIVEUNSUPPORTED` (ADR-0051 required native). */
function declineFor(err: unknown): { kind: 'unsupported'; feature: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const e = err as { name?: unknown; feature?: unknown; code?: unknown };
  if (e?.name === 'NotImplementedError') {
    return {
      kind: 'unsupported',
      feature: typeof e.feature === 'string' ? e.feature : 'not-implemented',
      message,
    };
  }
  if (e?.code === 'ENATIVEUNSUPPORTED') {
    return { kind: 'unsupported', feature: 'ENATIVEUNSUPPORTED', message };
  }
  return { kind: 'unsupported', feature: 'resolve-error', message };
}
