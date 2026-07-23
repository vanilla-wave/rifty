/**
 * Owner-boot eddy bundle prefetch (ADR-0195): start the bundle fetch for a
 * from-scratch preset BEFORE its `npm install` boot line runs, so the resolver
 * round-trip overlaps owner boot work (git init, seeding, pty/shell setup).
 *
 * Returns undefined when the resolver is off or package.json is a shape the
 * installer would reject (the install itself surfaces the loud error). The
 * handle is canonically keyed — install() ignores a prefetch whose request no
 * longer matches (e.g. the user edited deps), never trusts it.
 */
import {
  type EddyPrefetchHandle,
  eddyRequestFromPackageJson,
  startEddyPrefetch,
} from '@riftydev/npm-client';

/**
 * The owner-boot prefetch COMPOSITION policy (ADR-0194/0195), factored out of
 * the boot closure so it is unit-testable without a worker realm:
 *
 *   - `clear` — not a from-scratch preset, or the resolver is off: drop any
 *     in-flight handle (a reload of an installed tree never prefetches).
 *   - `keep` — same `config` as the in-flight handle: DON'T re-prime (a second
 *     POST would discard the download and race a duplicate 7MB stream — measured
 *     2026-07-02). Config = the boot identity `[specId, root, slug, packageJson]`.
 *   - `skip` — a stamp will suppress the install: record the config but fire no
 *     prefetch (nothing to feed).
 *   - `start` — fetch, pinned by a LEARNED pin over the coarse env pin (ADR-0194).
 *
 * `isStamped`/`pinFor` are THUNKS so the deliberate ordering holds — the stamp
 * read (sync, `syncMirror`) runs only AFTER the cheap clear/keep gates, and the
 * pin read only when actually starting.
 */
export type InstallPrefetchDecision =
  | { readonly kind: 'clear' }
  | { readonly kind: 'keep' }
  | { readonly kind: 'skip'; readonly config: string }
  | { readonly kind: 'start'; readonly config: string; readonly closureHash: string | undefined };

export function decideInstallPrefetch(inputs: {
  readonly devFromScratch: boolean;
  readonly resolverUrl: string | undefined;
  readonly config: string;
  readonly hasHandle: boolean;
  readonly prevConfig: string | undefined;
  readonly isStamped: () => boolean;
  /** Learned pin ?? env pin — read only when a prefetch actually starts. */
  readonly pinFor: () => string | undefined;
}): InstallPrefetchDecision {
  if (!inputs.devFromScratch || !inputs.resolverUrl) return { kind: 'clear' };
  if (inputs.hasHandle && inputs.prevConfig === inputs.config) return { kind: 'keep' };
  if (inputs.isStamped()) return { kind: 'skip', config: inputs.config };
  return { kind: 'start', config: inputs.config, closureHash: inputs.pinFor() };
}

export function startInstallPrefetch(opts: {
  readonly packageJsonText: string;
  readonly resolverUrl: string | undefined;
  /** Pinned closure hash (`VITE_RIFTY_EDDY_PINS`) → cacheable GET; absent → POST. */
  readonly closureHash?: string | undefined;
  /** CDN base for the pinned GET (`VITE_RIFTY_EDDY_BUNDLE_URL`); defaults to the resolver. */
  readonly bundleBaseUrl?: string | undefined;
  /** Test seam; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}): EddyPrefetchHandle | undefined {
  if (!opts.resolverUrl) return undefined;
  const request = eddyRequestFromPackageJson(opts.packageJsonText);
  if (!request) return undefined;
  return startEddyPrefetch({
    resolverUrl: opts.resolverUrl,
    request,
    ...(opts.closureHash ? { closureHash: opts.closureHash } : {}),
    ...(opts.bundleBaseUrl ? { bundleBaseUrl: opts.bundleBaseUrl } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}
