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
import { bakedOverrides } from '@riftydev/shadow-registry';

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
  if (builtin) return { ...parseTarget(builtin, name), source: 'baked' };
  return null;
}

/** npm's bare value (`"8.0.16"`, `"^1"`, `"v8.0.16"`) is a range for the overridden name. */
function isNpmBareVersionRange(spec: string): boolean {
  if (spec.startsWith('$') || spec.includes('/') || spec.startsWith('@')) return false;
  if (spec === '*' || spec.includes('||') || /^[\^~><=]/.test(spec) || /^\d/.test(spec)) {
    return true;
  }
  // `v1.2.3` is a version. `v8` is the package of that name.
  return /^v\d+\./.test(spec);
}

function parseTarget(
  target: string,
  overriddenName: string,
): { name: string; range: string | null } {
  // Accept formats:
  //   "bcryptjs"             → name=bcryptjs, range=null (latest)
  //   "bcryptjs@2.x"         → name=bcryptjs, range="2.x"
  //   "npm:bcryptjs@2.x"     → npm alias form, same as above
  //   "8.0.16" / "^8"        → name=overriddenName, range=the bare spec (npm)
  let str = target;
  if (str.startsWith('npm:')) str = str.slice(4);
  const at = str.lastIndexOf('@');
  if (at > 0) return { name: str.slice(0, at), range: str.slice(at + 1) };
  if (isNpmBareVersionRange(str)) return { name: overriddenName, range: str };
  return { name: str, range: null };
}
