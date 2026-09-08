import { dirname } from '@riftydev/vfs';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function ownKeys(value: object): readonly string[] {
  return Object.keys(value).sort(compareCodeUnits);
}

export function exactObject(
  value: unknown,
  expected: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const actual = ownKeys(record);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has invalid keys`);
  }
  return record;
}

export function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

export function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

export function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new TypeError(
      `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readJson(authority: OwnerVfsAuthority, path: string, label: string): unknown {
  return parseJsonBytes(authority.readFileBytesSync(path), label);
}

export function ensureParent(authority: OwnerVfsAuthority, path: string): void {
  authority.mkdirSync(dirname(path), { recursive: true });
}

export function writeJson(authority: OwnerVfsAuthority, path: string, value: unknown): void {
  ensureParent(authority, path);
  authority.writeFileSync(path, jsonBytes(value));
}
