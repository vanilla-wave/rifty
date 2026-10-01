/**
 * Shadow-registry overrides (D-005).
 *
 * Source of truth is user `package.json` `overrides`. We layer a few baked-in
 * substitutions on top of that — popular native packages get redirected to
 * known WASM/JS alternatives so they don't fail with `.node` loading errors.
 *
 * Per ADR 0015, the baked-in table lives in `@riftydev/shadow-registry`; this
 * file is the thin consumer-side adapter that owns the lookup function and
 * target-string parsing.
 */
import { NotImplementedError } from '@riftydev/io';
import { bakedOverrides } from '@riftydev/shadow-registry';
import { isRangeLike } from './semver.ts';

export interface OverrideMap {
  /** Map from package name (or `parent>child`) to replacement target. */
  [key: string]: string;
}

export interface ResolvedOverrideTarget {
  name: string;
  range: string | null;
  /** Provenance (ADR-0188): only `'baked'` redirects print the shadow-registry
   * substitution line — a user-authored override is not a silent substitution. */
  source: 'user' | 'baked';
}

export function resolveOverride(
  name: string,
  parent: string | undefined,
  userOverrides: OverrideMap = {},
): ResolvedOverrideTarget | null {
  const key = parent ? `${parent}>${name}` : name;
  const userMatch = userOverrides[key] ?? userOverrides[name];
  if (userMatch) return { ...parseTarget(userMatch, name), source: 'user' };
  const builtin = bakedOverrides[name];
  if (builtin) return { ...parseTarget(builtin), source: 'baked' };
  return null;
}

function parseTarget(target: string, keyName?: string): { name: string; range: string | null } {
  // Accept formats:
  //   "bcryptjs"             → name=bcryptjs, range=null (latest)
  //   "bcryptjs@2.x"         → name=bcryptjs, range="2.x"
  //   "npm:bcryptjs@2.x"     → npm alias form, same as above
  //   "8.0.16" (user value)  → npm's bare-version spelling: the KEYED package
  //                            at that range (npa.resolve(key, value)); only
  //                            range-like values — a bare name keeps the
  //                            replacement reading above.
  if (target.startsWith('$')) {
    throw new NotImplementedError(
      'npm-client.overrides.dollar-ref',
      `overrides value "${target}" is an npm $ref — not implemented`,
    );
  }
  let str = target;
  const alias = str.startsWith('npm:');
  if (alias) str = str.slice(4);
  const at = str.lastIndexOf('@');
  if (at <= 0) {
    // The keyed-package range reading never applies to the `npm:` alias form:
    // `npm:8` names the package "8", it is not a range on the keyed package.
    if (!alias && keyName !== undefined && isRangeLike(str)) {
      return { name: keyName, range: str };
    }
    return { name: str, range: null };
  }
  return { name: str.slice(0, at), range: str.slice(at + 1) };
}
