/**
 * Shadow-registry overrides (D-005).
 *
 * Source of truth is user `package.json` `overrides`. We layer a few baked-in
 * substitutions on top of that — popular native packages get redirected to
 * known WASM/JS alternatives so they don't fail with `.node` loading errors.
 *
 * Per ADR 0015, the baked-in table lives in `@rifty/shadow-registry`; this
 * file is the thin consumer-side adapter that owns the lookup function and
 * target-string parsing.
 */
import { bakedOverrides } from '@rifty/shadow-registry';

export interface OverrideMap {
  /** Map from package name (or `parent>child`) to replacement target. */
  [key: string]: string;
}

export function resolveOverride(
  name: string,
  parent: string | undefined,
  userOverrides: OverrideMap = {},
): { name: string; range: string | null } | null {
  const key = parent ? `${parent}>${name}` : name;
  const userMatch = userOverrides[key] ?? userOverrides[name];
  if (userMatch) return parseTarget(userMatch);
  const builtin = bakedOverrides[name];
  if (builtin) return parseTarget(builtin);
  return null;
}

function parseTarget(target: string): { name: string; range: string | null } {
  // Accept formats:
  //   "bcryptjs"             → name=bcryptjs, range=null (latest)
  //   "bcryptjs@2.x"         → name=bcryptjs, range="2.x"
  //   "npm:bcryptjs@2.x"     → npm alias form, same as above
  let str = target;
  if (str.startsWith('npm:')) str = str.slice(4);
  const at = str.lastIndexOf('@');
  if (at <= 0) return { name: str, range: null };
  return { name: str.slice(0, at), range: str.slice(at + 1) };
}
