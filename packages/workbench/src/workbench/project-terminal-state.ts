import { assertProjectPath } from './project-file-boundary.ts';

export interface ProjectTerminalSnapshot {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new TypeError(`${label} has invalid keys`);
  }
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function ownEnvironment(value: unknown): Readonly<Record<string, string>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Project terminal env must be a plain object');
  }
  const entries: [string, string][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('Project terminal env keys must be non-empty strings');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(
        `Project terminal env ${JSON.stringify(key)} must be a string data property`,
      );
    }
    entries.push([key, descriptor.value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

/** Package-internal exact record owner; caller supplies the cwd namespace check. */
export function ownTerminalStateRecord(value: unknown, label: string): ProjectTerminalSnapshot {
  const record = exactRecord(value, ['cwd', 'env'], label);
  if (typeof record.cwd !== 'string') {
    throw new TypeError(`${label}.cwd must be a string`);
  }
  return Object.freeze({ cwd: record.cwd, env: ownEnvironment(record.env) });
}

/** Clone/freeze one exact public project-rooted terminal value. */
export function ownProjectTerminalSnapshot(value: unknown): ProjectTerminalSnapshot {
  const state = ownTerminalStateRecord(value, 'Project terminal snapshot');
  return Object.freeze({
    cwd: assertProjectPath(state.cwd, { allowRoot: true }),
    env: state.env,
  });
}
