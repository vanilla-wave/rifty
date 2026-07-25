import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function identityForRecipe(recipe: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(recipe)).digest('hex')}`;
}

/**
 * Behavior-bearing esbuild-runtime-policy fields. Compat prose
 * (`state`/`currentSurfaces`/`gaps`/`patchDescriptions`/`validationSource`/
 * `tests`/`limitations`) must NOT flip the install identity — a doc edit once
 * invalidated every deployed stamp and forced a 27 MB snapshot rebake.
 */
const IDENTITY_POLICY_FIELDS = ['schema', 'api', 'version', 'consumer', 'source', 'wasm', 'patches'] as const;

export function identityPolicyProjection(policy: unknown): Record<string, unknown> {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('esbuild runtime policy must be an object');
  }
  const record = policy as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    IDENTITY_POLICY_FIELDS.map((field) => {
      if (record[field] === undefined) {
        throw new Error(`esbuild runtime policy is missing identity field '${field}'`);
      }
      return [field, record[field]];
    }),
  );
}
