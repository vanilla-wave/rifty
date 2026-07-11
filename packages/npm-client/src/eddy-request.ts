/**
 * Canonical eddy resolve-request — ONE definition of the wire body shape and
 * its equality key, shared by the installer's fast path and out-of-band
 * prefetchers (`eddy-prefetch.ts`). A prefetch started from raw package.json
 * text must produce byte-for-byte the SAME request the later `install()` builds
 * from the same manifest, or the prefetch is (correctly) ignored.
 */

import type { OverrideMap } from './overrides.ts';

/** The POST body (ADR-0182): devDependencies are pre-merged into
 * `dependencies` (installer semantics), optionals carved out. */
export interface EddyRequestBody {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  overrides?: OverrideMap;
}

/**
 * Build the request an `install({ vfs, cwd })` call would send for this
 * package.json — the EXACT `normalizeInstallArgs` merge: `{ ...devDependencies,
 * ...dependencies }`, optionalDependencies carved out of that merge, overrides
 * carried when non-empty. Returns `null` on any shape the installer would
 * reject (malformed JSON, non-object, nested/non-string entries): a prefetch
 * must never throw — the install itself surfaces the loud error.
 */
export function eddyRequestFromPackageJson(text: string): EddyRequestBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const dev = stringRecordOrNull(raw.devDependencies);
  const deps = stringRecordOrNull(raw.dependencies);
  const optional = stringRecordOrNull(raw.optionalDependencies);
  const overrides = stringRecordOrNull(raw.overrides);
  if (!dev || !deps || !optional || !overrides) return null;
  const dependencies = { ...dev, ...deps };
  for (const name of Object.keys(optional)) delete dependencies[name];
  const body: EddyRequestBody = { dependencies, optionalDependencies: optional };
  if (Object.keys(overrides).length > 0) body.overrides = overrides;
  return body;
}

function stringRecordOrNull(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range !== 'string') return null;
    out[name] = range;
  }
  return out;
}

/**
 * Order-independent equality key for a request. Mirrors the server's
 * `depSetKey` canonicalization (sorted records) but ALSO folds in `prefer`:
 * unlike the server cache (where `prefer` is policy, not identity), a prefetch
 * made with a different `prefer` must not satisfy an install that asked for the
 * other policy.
 */
export function canonicalEddyRequestKey(
  body: EddyRequestBody,
  prefer: 'cached' | 'online' = 'cached',
): string {
  return JSON.stringify({
    dependencies: sortRecord(body.dependencies),
    optionalDependencies: sortRecord(body.optionalDependencies),
    overrides: sortRecord(body.overrides ?? {}),
    prefer,
  });
}

function sortRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(rec).sort()) out[k] = rec[k] as string;
  return out;
}

/** `GET <resolverUrl>/bundle/<closureHash>` URL. The hash is `sha256-<base64>`
 * (carries `/`+`=`), so the path segment is percent-encoded. */
export function bundleUrlFor(resolverUrl: string, closureHash: string): string {
  return `${resolverUrl.replace(/\/+$/, '')}/bundle/${encodeURIComponent(closureHash)}`;
}

/** Response header eddy sets to `1` when the served bundle was proven durable
 * in the immutable store — the gate for LEARNING a POST-computed closure hash
 * as a pin (ADR-0194): a pin must never point at an object the store may not
 * hold. One constant, both consumers (installer adoption + revalidate). */
export const EDDY_STORE_DURABLE_HEADER = 'x-eddy-store-durable';
