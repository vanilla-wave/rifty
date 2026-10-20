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
import { type ShadowRuntimeTier, builtinRecipeForTier } from '@riftydev/shadow-registry/internal';
import { parseNpmAlias } from './npm-alias.ts';
import { isLooseSemverRange } from './semver-loose-range.ts';

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

/** A user value as npm reads it (ADR-0451): the overridden edge's own spec, or
 * a rifty substitution target. */
type UserOverride =
  | Readonly<{ spec: string }>
  | Readonly<{ target: { name: string; range: string | null } }>;

export function resolveOverride(
  name: string,
  parent: string | undefined,
  userOverrides: OverrideMap = {},
  runtimeTier?: ShadowRuntimeTier,
): ResolvedOverrideTarget | null {
  const user = userOverride(name, parent, userOverrides);
  if (user && 'spec' in user) return { name, range: user.spec, source: 'user' };
  if (user) return { ...user.target, source: 'user' };
  const recipe = builtinRecipeForTier(name, runtimeTier);
  if (recipe?.acquisition.kind === 'registry')
    return {
      name: recipe.acquisition.name,
      range: recipe.admission.kind === 'requested-range' ? null : recipe.acquisition.version,
      source: 'baked',
    };
  const builtin = bakedOverrides[name];
  if (builtin) return { ...parseTarget(builtin), source: 'baked' };
  return null;
}

/**
 * The spec a user override puts on the edge when npm reads the value as a
 * version/range/`latest` of the overridden package (ADR-0451), else null.
 * Such an override is the edge's spec, not a substitution.
 */
export function userOverrideSpec(
  name: string,
  parent: string | undefined,
  userOverrides: OverrideMap = {},
): string | null {
  const user = userOverride(name, parent, userOverrides);
  return user && 'spec' in user ? user.spec : null;
}

function userOverride(
  name: string,
  parent: string | undefined,
  userOverrides: OverrideMap,
): UserOverride | null {
  const key = parent ? `${parent}>${name}` : name;
  const value = userOverrides[key] ?? userOverrides[name];
  // npm keeps the edge's own spec for '' and '*' (Arborist override-set/edge).
  if (value === undefined || value === '' || value === '*') return null;
  // `npm:` aliases and the rifty `name@range` spelling name a package.
  if (/^npm:/i.test(value) || value.lastIndexOf('@') > 0) return { target: parseTarget(value) };
  const spec = value.trim();
  if (spec === 'latest' || isLooseSemverRange(spec)) return { spec };
  return { target: parseTarget(value) };
}

function parseTarget(target: string): { name: string; range: string | null } {
  // Accept formats:
  //   "bcryptjs"             → name=bcryptjs, range=null (keeps the edge range)
  //   "bcryptjs@2.x"         → name=bcryptjs, range="2.x"
  //   "npm:bcryptjs@2.x"     → npm alias form, same as above
  const alias = parseNpmAlias(target);
  if (alias) return alias;
  const str = target;
  const at = str.lastIndexOf('@');
  if (at <= 0) return { name: str, range: null };
  return { name: str.slice(0, at), range: str.slice(at + 1) };
}

/** npm aliases override the edge spec while preserving its install name. */
export function hasNpmAliasOverride(
  name: string,
  parent: string | undefined,
  overrides: OverrideMap = {},
): boolean {
  return (
    parseNpmAlias(overrides[parent ? `${parent}>${name}` : name] ?? overrides[name] ?? null) !==
    null
  );
}
