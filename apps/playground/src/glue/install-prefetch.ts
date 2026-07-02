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
