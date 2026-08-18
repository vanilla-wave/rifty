// Shared validation vocabulary for the owner protocol inspectors
// (owner-protocol.ts, owner-protocol-pty.ts). Message-shape knowledge stays
// with the message owners; this leaf knows only values.

export function invalid(label: string): TypeError {
  return new TypeError(`Invalid ${label}`);
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(label);
  return value as Record<string, unknown>;
}

export function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function exactMatch(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function exact(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (!exactMatch(value, expected)) throw invalid(label);
}

export function optionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): string[] {
  return [...required, ...optional.filter((key) => own(value, key))];
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(label);
  return value;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(label);
  return value;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(label);
  return value;
}

export function bytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw invalid(label);
  return value;
}

export function dimension(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalid(label);
  return value as number;
}

export function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(label);
  return value as number;
}

export function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw invalid(label);
  return value as number;
}

export function port(value: unknown, label: string): number {
  const number = dimension(value, label);
  if (number > 65_535) throw invalid(label);
  return number;
}

export function positiveFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw invalid(label);
  return value;
}

export function progressCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(label);
  return value;
}

export function inspectStringMap(value: unknown, label: string): void {
  const map = record(value, label);
  for (const [key, entry] of Object.entries(map)) {
    if (key.length === 0 || typeof entry !== 'string') throw invalid(label);
  }
}

export function copyStringMap(value: unknown, label: string): Readonly<Record<string, string>> {
  inspectStringMap(value, label);
  const map = value as Record<string, string>;
  return Object.freeze(Object.fromEntries(Object.entries(map)));
}

export function absoluteHttpUrl(value: unknown, label: string): string {
  const candidate = nonEmptyString(value, label);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalid(label);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw invalid(label);
  }
  return url.href;
}
