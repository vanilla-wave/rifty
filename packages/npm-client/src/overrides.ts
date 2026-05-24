/**
 * Shadow-registry overrides (D-005).
 *
 * Source of truth is user `package.json` `overrides`. We layer a few baked-in
 * substitutions on top of that — popular native packages get redirected to
 * known WASM/JS alternatives so they don't fail with `.node` loading errors.
 */

const BUILT_IN_OVERRIDES: Record<string, string> = {
  // bcrypt's native bindings don't load in the browser; bcryptjs is a drop-in.
  bcrypt: 'bcryptjs',
};

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
  const builtin = BUILT_IN_OVERRIDES[name];
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
