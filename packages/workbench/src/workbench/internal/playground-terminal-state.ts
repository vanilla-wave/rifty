import type {
  PlaygroundProjectOpenOptions,
  PlaygroundTerminalStateRestoreInput,
} from '../playground.ts';
import { assertProjectPath, toOwnerProjectPath, toProjectPath } from '../project-file-boundary.ts';
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

function restoreInput(value: unknown): PlaygroundTerminalStateRestoreInput {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Playground terminal restore input must be a plain object');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('format') || !keys.includes('state')) {
    throw new TypeError('Playground terminal restore input must contain format and state');
  }
  const field = (key: 'format' | 'state'): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`Playground terminal restore input.${key} must be a data property`);
    }
    return descriptor.value;
  };
  const format = field('format');
  if (format !== 'project-rooted' && format !== 'legacy-workspace-absolute') {
    throw new TypeError('Playground terminal restore input.format is invalid');
  }
  return Object.freeze({
    format,
    state: ownTerminalStateRecord(field('state'), 'Persisted Playground terminal state'),
  });
}

function safeProjectCwd(cwd: string): string {
  try {
    return assertProjectPath(cwd, { allowRoot: true });
  } catch {
    return '/';
  }
}

/** Persisted host state → public project-rooted state using this open's adoption selection. */
export function restorePlaygroundTerminalState(
  value: unknown,
  legacyWorkspacePrefix?: string,
): ProjectTerminalSnapshot {
  const input = restoreInput(value);
  let cwd = '/';
  if (input.format === 'project-rooted') {
    cwd = safeProjectCwd(input.state.cwd);
  } else if (legacyWorkspacePrefix !== undefined) {
    if (input.state.cwd === legacyWorkspacePrefix) cwd = '/';
    else if (input.state.cwd.startsWith(`${legacyWorkspacePrefix}/`)) {
      cwd = safeProjectCwd(input.state.cwd.slice(legacyWorkspacePrefix.length));
    }
  }
  return Object.freeze({ cwd, env: input.state.env });
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
  if (
    keys.some((key) => key !== 'initialTerminalState' && key !== 'onRuntimeAssetProgress') ||
    keys.length > 2
  ) {
    throw new TypeError('Playground project open options have invalid keys');
  }
  if (keys.length === 0) return Object.freeze({});
  let initialTerminalState: ProjectTerminalSnapshot | undefined;
  if (keys.includes('initialTerminalState')) {
    const descriptor = optionDataProperty(value, 'initialTerminalState');
    if (descriptor !== undefined) {
      initialTerminalState = ownProjectTerminalSnapshot(descriptor);
    }
  }
  let onRuntimeAssetProgress: PlaygroundProjectOpenOptions['onRuntimeAssetProgress'];
  if (keys.includes('onRuntimeAssetProgress')) {
    const descriptor = optionDataProperty(value, 'onRuntimeAssetProgress');
    if (descriptor !== undefined && typeof descriptor !== 'function') {
      throw new TypeError(
        'Playground project open options.onRuntimeAssetProgress must be a function',
      );
    }
    onRuntimeAssetProgress = descriptor as typeof onRuntimeAssetProgress;
  }
  return Object.freeze({
    ...(initialTerminalState === undefined ? {} : { initialTerminalState }),
    ...(onRuntimeAssetProgress === undefined ? {} : { onRuntimeAssetProgress }),
  });
}

function optionDataProperty(
  value: object,
  key: 'initialTerminalState' | 'onRuntimeAssetProgress',
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(
      `Playground project open options.${key} must be an enumerable data property`,
    );
  }
  return descriptor.value;
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
