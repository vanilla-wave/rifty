import type { InspectedPlaygroundProjectDefinition } from '../workbench/internal/playground-project-definition.ts';
import { exactObject, nonEmpty } from './playground-catalog-json.ts';

export type CatalogAdoption =
  | { readonly kind: 'pending-adoption'; readonly sourceRoot: string }
  | {
      readonly kind: 'adopted';
      readonly definitionIdentity: string;
      readonly baselineFingerprint: string;
      readonly applicationFingerprint?: string;
    };

export function parseAdoption(value: unknown, label: string): CatalogAdoption {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'pending-adoption') {
    const record = exactObject(value, ['kind', 'sourceRoot'], label);
    return Object.freeze({
      kind,
      sourceRoot: nonEmpty(record.sourceRoot, `${label}.sourceRoot`),
    });
  }
  if (kind === 'adopted') {
    const keys = Object.keys(value as object);
    const hasApplication = keys.includes('applicationFingerprint');
    const record = exactObject(
      value,
      hasApplication
        ? ['kind', 'definitionIdentity', 'baselineFingerprint', 'applicationFingerprint']
        : ['kind', 'definitionIdentity', 'baselineFingerprint'],
      label,
    );
    return Object.freeze({
      kind,
      definitionIdentity: nonEmpty(record.definitionIdentity, `${label}.definitionIdentity`),
      baselineFingerprint: nonEmpty(record.baselineFingerprint, `${label}.baselineFingerprint`),
      ...(hasApplication
        ? {
            applicationFingerprint: nonEmpty(
              record.applicationFingerprint,
              `${label}.applicationFingerprint`,
            ),
          }
        : {}),
    });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

export function adoptedProof(definition: InspectedPlaygroundProjectDefinition): CatalogAdoption {
  return Object.freeze({
    kind: 'adopted',
    definitionIdentity: definition.identity,
    baselineFingerprint: definition.baselineFingerprint,
    applicationFingerprint: definition.applicationFingerprint,
  });
}

export function proofMatches(
  adoption: CatalogAdoption,
  definition: InspectedPlaygroundProjectDefinition,
): boolean {
  return (
    adoption.kind === 'adopted' &&
    adoption.definitionIdentity === definition.identity &&
    adoption.baselineFingerprint === definition.baselineFingerprint
  );
}

export function baselineMatches(
  entry: { readonly starterId: string; readonly adoption: CatalogAdoption },
  definition: InspectedPlaygroundProjectDefinition,
): boolean {
  return (
    entry.starterId === definition.starterId &&
    entry.adoption.kind === 'adopted' &&
    entry.adoption.baselineFingerprint === definition.baselineFingerprint
  );
}

function parseLengthPrefixedFields(identity: string, prefix: string): readonly string[] | null {
  if (!identity.startsWith(`${prefix}:`)) return null;
  let rest = identity.slice(prefix.length + 1);
  const fields: string[] = [];
  while (rest.length > 0) {
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const length = Number(rest.slice(0, colon));
    if (!Number.isSafeInteger(length) || length < 0) return null;
    const start = colon + 1;
    const end = start + length;
    if (end > rest.length) return null;
    fields.push(rest.slice(start, end));
    rest = rest.slice(end);
  }
  return fields;
}

function applicationKeyFromBaseline(baseline: string): string | null {
  const fields = parseLengthPrefixedFields(baseline, 'playground-baseline:v1');
  if (fields === null) return null;
  return fields
    .filter((field) => !field.startsWith('snapshot-id:') && !field.startsWith('snapshot-template:'))
    .join('\0');
}

export function applicationBaselineMatches(
  entry: { readonly starterId: string; readonly adoption: CatalogAdoption },
  definition: InspectedPlaygroundProjectDefinition,
): boolean {
  if (entry.starterId !== definition.starterId || entry.adoption.kind !== 'adopted') return false;
  if (entry.adoption.applicationFingerprint !== undefined) {
    return entry.adoption.applicationFingerprint === definition.applicationFingerprint;
  }
  const stored = applicationKeyFromBaseline(entry.adoption.baselineFingerprint);
  const current = applicationKeyFromBaseline(definition.baselineFingerprint);
  return stored !== null && current !== null && stored === current;
}
