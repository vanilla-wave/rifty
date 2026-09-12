import { normalizePath } from '@riftydev/vfs';
import type { FsOperation, ToolchainCommandInput, ToolchainProjectOptions } from './protocol.ts';

function record(
  input: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  )
    throw new TypeError(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowed.includes(key)))
    throw new TypeError(`${label} has unknown fields`);
  if (Object.values(descriptors).some((d) => !('value' in d)))
    throw new TypeError(`${label} has accessor fields`);
  return input as Record<string, unknown>;
}

export function projectPath(value: unknown, root: string): string {
  if (typeof value !== 'string' || value.includes('\0'))
    throw new TypeError('project path must be a string without NUL');
  return normalizePath(value.startsWith('/') ? value : `${root}/${value}`);
}

export function validateProjectOptions(input: ToolchainProjectOptions): ToolchainProjectOptions {
  const value = record(input, ['root', 'readonlyPaths', 'allowedCommands'], 'project');
  if (
    typeof value.root !== 'string' ||
    !value.root.startsWith('/') ||
    value.root.includes('\0') ||
    normalizePath(value.root) !== value.root
  )
    throw new TypeError('project root must be a normalized absolute VFS path');
  const root = value.root;
  const strings = (items: unknown, label: string): readonly string[] => {
    if (
      !Array.isArray(items) ||
      items.some((s) => typeof s !== 'string' || s.includes('\0')) ||
      Object.keys(items).length !== items.length
    )
      throw new TypeError(`${label} must be a dense string array without NUL`);
    return Object.freeze([...items]);
  };
  return Object.freeze({
    root,
    ...(value.readonlyPaths === undefined
      ? {}
      : {
          readonlyPaths: Object.freeze(
            strings(value.readonlyPaths, 'readonlyPaths').map((path) => projectPath(path, root)),
          ),
        }),
    ...(value.allowedCommands === undefined
      ? {}
      : { allowedCommands: strings(value.allowedCommands, 'allowedCommands') }),
  });
}

export function validateCommandInput(input: ToolchainCommandInput): ToolchainCommandInput {
  const value = record(input, ['project', 'command', 'cwd', 'env'], 'command');
  const project = validateProjectOptions(value.project as ToolchainProjectOptions);
  if (typeof value.command !== 'string' || value.command.includes('\0'))
    throw new TypeError('command must be a string without NUL');
  const cwd = projectPath(value.cwd, project.root);
  if (value.env === null || typeof value.env !== 'object' || Array.isArray(value.env))
    throw new TypeError('command env must be a string record');
  const env = record(value.env, Object.keys(value.env), 'command env');
  if (
    Object.entries(env).some(
      ([key, entry]) =>
        key.includes('\0') ||
        key.includes('=') ||
        typeof entry !== 'string' ||
        entry.includes('\0'),
    )
  )
    throw new TypeError('command env must contain valid string entries');
  return Object.freeze({
    project,
    command: value.command,
    cwd,
    env: Object.freeze({ ...env }) as Readonly<Record<string, string>>,
  });
}

export function projectFsOperation(operation: FsOperation, root: string): FsOperation {
  const copy = structuredClone(operation);
  if (copy.op === 'rename')
    return {
      ...copy,
      sourcePath: projectPath(copy.sourcePath, root),
      targetPath: projectPath(copy.targetPath, root),
    };
  if ('path' in copy) return { ...copy, path: projectPath(copy.path, root) };
  return copy;
}
