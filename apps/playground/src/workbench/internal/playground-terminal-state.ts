import type { PlaygroundProjectOpenOptions } from '../playground.ts';
import { toOwnerProjectPath, toProjectPath } from '../project-file-boundary.ts';
import {
  type ProjectTerminalSnapshot,
  ownProjectTerminalSnapshot,
  ownTerminalStateRecord,
} from '../project-terminal-state.ts';

export { ownProjectTerminalSnapshot } from '../project-terminal-state.ts';

export interface OwnerProjectTerminalState {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export function ownPlaygroundProjectOpenOptions(value: unknown): PlaygroundProjectOpenOptions {
  if (value === undefined) return Object.freeze({});
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Playground project open options must be a plain object');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => key !== 'initialTerminalState') || keys.length > 1) {
    throw new TypeError('Playground project open options have invalid keys');
  }
  if (keys.length === 0) return Object.freeze({});
  const descriptor = Object.getOwnPropertyDescriptor(value, 'initialTerminalState');
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(
      'Playground project open options.initialTerminalState must be an enumerable data property',
    );
  }
  if (descriptor.value === undefined) return Object.freeze({});
  return Object.freeze({ initialTerminalState: ownProjectTerminalSnapshot(descriptor.value) });
}

/** Public cwd → exact physical session root; stale directories reset to root, env unchanged. */
export function projectTerminalStateToOwner(
  projectRoot: string,
  value: ProjectTerminalSnapshot,
  isDirectory: (ownerPath: string) => boolean,
): OwnerProjectTerminalState {
  const state = ownProjectTerminalSnapshot(value);
  const requested = toOwnerProjectPath(projectRoot, state.cwd, { allowRoot: true });
  const cwd = requested === projectRoot || isDirectory(requested) ? requested : projectRoot;
  return Object.freeze({ cwd, env: Object.freeze({ ...state.env }) });
}

/** Physical owner cwd → public project root; an exact-root escape rejects the whole value. */
export function projectTerminalStateFromOwner(
  projectRoot: string,
  value: unknown,
): ProjectTerminalSnapshot {
  const state = ownTerminalStateRecord(value, 'Owner terminal state');
  return Object.freeze({
    cwd: toProjectPath(projectRoot, state.cwd),
    env: state.env,
  });
}
