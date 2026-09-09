import { defineOwnEnumerableProperty } from './own-property.ts';

interface WorkbenchEddyOptions {
  readonly resolverUrl: string;
  readonly bundleBaseUrl?: string;
  readonly presetPins?: Readonly<Record<string, string>>;
}

export type WorkbenchPackageAcquisition =
  | {
      readonly mode?: 'registry';
      readonly registryUrl: string;
      readonly eddy?: WorkbenchEddyOptions;
    }
  | { readonly mode: 'snapshot-only'; readonly registryUrl?: never; readonly eddy?: never };

export type NormalizedWorkbenchPackageAcquisition =
  | {
      readonly mode: 'registry';
      readonly registryUrl: string;
      readonly eddy?: Required<WorkbenchEddyOptions>;
    }
  | { readonly mode: 'snapshot-only'; readonly registryUrl?: never; readonly eddy?: never };

type EndpointUrl = (value: unknown, field: string, pathBase: boolean) => string;

/** Validate all descriptors before reading branch data; cloning must never execute input. */
function data(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${field} must contain plain data`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || descriptor?.enumerable !== true || !('value' in descriptor))
      throw new TypeError(`${field} must contain enumerable data properties`);
  }
  return value as Record<string, unknown>;
}

function keys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError(`${field} has invalid fields`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function pins(value: unknown): Readonly<Record<string, string>> {
  const input = data(value, 'packageAcquisition.eddy.presetPins');
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.length === 0)
      throw new TypeError('packageAcquisition.eddy.presetPins key must be non-empty');
    defineOwnEnumerableProperty(
      result,
      key,
      text(value, `packageAcquisition.eddy.presetPins.${key}`),
    );
  }
  return Object.freeze(result);
}

function acquisition(
  value: unknown,
  endpointUrl: EndpointUrl,
  normalized: boolean,
): NormalizedWorkbenchPackageAcquisition {
  const input = data(value, 'packageAcquisition');
  if (Object.hasOwn(input, 'snapshotUrl'))
    throw new TypeError(
      'packageAcquisition.snapshotUrl is retired; trusted snapshots belong to Playground definitions',
    );
  if (input.mode === 'snapshot-only') {
    keys(input, ['mode'], [], 'packageAcquisition');
    return Object.freeze({ mode: 'snapshot-only' });
  }
  if (input.mode !== 'registry' && (normalized || input.mode !== undefined))
    throw new TypeError('packageAcquisition.mode must be registry or snapshot-only');
  keys(
    input,
    normalized ? ['mode', 'registryUrl'] : ['registryUrl'],
    normalized ? ['eddy'] : ['mode', 'eddy'],
    'packageAcquisition',
  );
  let eddy: Required<WorkbenchEddyOptions> | undefined;
  if (input.eddy !== undefined || (normalized && Object.hasOwn(input, 'eddy'))) {
    const raw = data(input.eddy, 'packageAcquisition.eddy');
    keys(
      raw,
      normalized ? ['resolverUrl', 'bundleBaseUrl', 'presetPins'] : ['resolverUrl'],
      normalized ? [] : ['bundleBaseUrl', 'presetPins'],
      'packageAcquisition.eddy',
    );
    const explicitBundle = raw.bundleBaseUrl !== undefined;
    const resolverUrl = endpointUrl(
      raw.resolverUrl,
      'packageAcquisition.eddy.resolverUrl',
      !explicitBundle,
    );
    eddy = Object.freeze({
      resolverUrl,
      bundleBaseUrl: explicitBundle
        ? endpointUrl(raw.bundleBaseUrl, 'packageAcquisition.eddy.bundleBaseUrl', true)
        : resolverUrl,
      presetPins: pins(raw.presetPins === undefined && !normalized ? {} : raw.presetPins),
    });
  }
  return Object.freeze({
    mode: 'registry',
    registryUrl: endpointUrl(input.registryUrl, 'packageAcquisition.registryUrl', true),
    ...(eddy === undefined ? {} : { eddy }),
  });
}

/** Page owns URL resolution once; owner revalidates the same closed, normalized data. */
export function normalizeWorkbenchPackageAcquisition(
  value: unknown,
  endpointUrl: EndpointUrl,
): NormalizedWorkbenchPackageAcquisition {
  return acquisition(value, endpointUrl, false);
}

export function inspectNormalizedWorkbenchPackageAcquisition(
  value: unknown,
): NormalizedWorkbenchPackageAcquisition {
  return acquisition(value, text, true);
}
