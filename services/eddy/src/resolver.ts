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
  type InstallTreeResult,
  type PackumentCacheLike,
  RegistryClient,
  ShadowAssetInstallError,
  type ShadowAssetInstaller,
  type TarballCache,
  VfsTarballCache,
  bundleCompletenessGap,
  closureHashOf,
  install,
  packEddyBundle,
} from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { readNpmClientVersion } from './npm-client-version.ts';
import { layeredTarballCache, packumentOverlay } from './shared-caches.ts';

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
  /** Process-wide packument cache (ADR-0194 §1); read through a per-request
   *  overlay, bypassed on reads for `prefer:'online'`. */
  packumentCache?: PackumentCacheLike;
  /** Process-wide immutable tarball cache (ADR-0194 §2); layered under a
   *  per-request VFS cache so a shared eviction can't break the harvest. */
  tarballCache?: TarballCache;
}

export type EddyResolveResult =
  | {
      kind: 'bundle';
      bytes: Uint8Array;
      manifest: EddyBundleManifestV1;
      /** Set by EddyCache: POST callers may learn pins only after durable store proof. */
      storeDurable?: boolean;
    }
  | { kind: 'unsupported'; feature: string; message: string };

const ROOT = '/work';

/** Eddy needs the resolved tree, never a false runtime-asset readiness claim. */
class EddyTreeHarvestBoundary extends Error {}

const treeHarvestShadowAssetInstaller: ShadowAssetInstaller = {
  async ensure() {
    throw new EddyTreeHarvestBoundary('Eddy harvest stops at the verified package tree');
  },
  async inspectReceipt() {
    return null;
  },
};

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

  const localTarballs = new VfsTarballCache(vfs);
  const tarballCache = deps.tarballCache
    ? layeredTarballCache(localTarballs, deps.tarballCache)
    : localTarballs;
  const packumentCache = deps.packumentCache
    ? packumentOverlay(deps.packumentCache, req.prefer !== 'online')
    : undefined;
  const registry = new RegistryClient({ baseUrl: deps.registryBaseUrl, fetch: deps.fetch });

  let result: InstallTreeResult;
  try {
    result = await install({
      vfs,
      cwd: ROOT,
      registry,
      tarballCache,
      shadowAssets: { installer: treeHarvestShadowAssetInstaller },
      ...(packumentCache ? { packumentCache } : {}),
    });
  } catch (err) {
    if (err instanceof ShadowAssetInstallError && err.cause instanceof EddyTreeHarvestBoundary) {
      result = err.treeResult;
    } else {
      return declineFor(err);
    }
  }

  // One tarball per unique (name@version); harvest the original gzip bytes the
  // installer cached, keyed by the integrity it verified them under.
  const seen = new Set<string>();
  const entries: EddyBundleTarballEntry[] = [];
  const tarballs: Array<{ entry: EddyBundleTarballEntry; bytes: Uint8Array }> = [];
  for (const pkg of result.packages) {
    const key = `${pkg.name}@${pkg.version}`;
    const integrity = (pkg as { integrity?: string }).integrity;
    // Candidate selection is intentionally permissive here; the exact
    // lockfile marker/completeness gate below is the sole authority that may
    // prove a missing tarball is synthesized rather than corrupt.
    if (!integrity) continue;
    if (seen.has(key)) continue;
    seen.add(key);
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

  const rootDependencies = result.lockfile.packages['']?.dependencies ?? {};
  const completenessGap = bundleCompletenessGap(result.lockfile, rootDependencies, entries);
  if (completenessGap !== null) {
    return {
      kind: 'unsupported',
      feature: 'bundle-incomplete',
      message: completenessGap,
    };
  }

  const manifest: EddyBundleManifestV1 = {
    format: EDDY_BUNDLE_FORMAT,
    npmClientVersion: readNpmClientVersion(),
    asOf: {
      resolvedAt: deps.now ? deps.now() : new Date().toISOString(),
      registry: deps.registryBaseUrl,
      closureHash: await closureHashOf(result.lockfile),
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
