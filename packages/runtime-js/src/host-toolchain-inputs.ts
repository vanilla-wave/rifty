import { normalizePath } from '@riftydev/vfs';
import {
  SANDBOX_TOOLCHAIN_PROTOCOL as TOOLCHAIN_PROTOCOL,
  type ToolchainActivationState,
  type ToolchainInstallRequest,
  type ToolchainRunBinRequest,
  type ToolchainStartBinRequest,
} from './protocol.ts';

export function decodeToolchainReady(value: unknown): 'opfs' | 'memory' | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).toSorted();
  if (
    keys.length !== 3 ||
    keys[0] !== 'protocol' ||
    keys[1] !== 'type' ||
    keys[2] !== 'vfsBackend'
  ) {
    return null;
  }
  if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) return null;
  const frame = value as Record<string, unknown>;
  if (frame.type !== 'toolchain-ready' || frame.protocol !== TOOLCHAIN_PROTOCOL) return null;
  return frame.vfsBackend === 'opfs' || frame.vfsBackend === 'memory' ? frame.vfsBackend : null;
}

export function exactInput(
  input: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${label} has symbol fields`);
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor)) throw new TypeError(`${label} has accessor fields`);
  }
  const actual = Object.keys(descriptors).toSorted();
  const expected = [...fields].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has extra or missing fields`);
  }
  return Object.freeze(
    Object.fromEntries(
      actual.map((field) => {
        const descriptor = descriptors[field];
        if (descriptor === undefined || !('value' in descriptor)) {
          throw new TypeError(`${label} has accessor fields`);
        }
        return [field, descriptor.value] as const;
      }),
    ),
  );
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || !value.startsWith('/')) {
    throw new TypeError(`${label} must be an absolute VFS path`);
  }
  const normalized = normalizePath(value);
  if (normalized !== value || value === '/') {
    throw new TypeError(`${label} must be a normalized non-root VFS path`);
  }
  return value;
}

export function validateInstallRequest(
  input: ToolchainInstallRequest,
  label: string,
): ToolchainInstallRequest {
  const record = exactInput(input, ['cwd', 'registryUrl'], `${label} input`);
  const cwd = absolutePath(record.cwd, `${label} cwd`);
  if (typeof record.registryUrl !== 'string' || record.registryUrl.length === 0) {
    throw new TypeError(`${label} registryUrl must be a non-empty string`);
  }
  return Object.freeze({ cwd, registryUrl: record.registryUrl });
}

function validateBinInput(
  input: unknown,
  fields: readonly string[],
  label: string,
): {
  readonly request: ToolchainRunBinRequest;
  readonly record: Readonly<Record<string, unknown>>;
} {
  const record = exactInput(input, fields, `${label} input`);
  const cwd = absolutePath(record.cwd, `${label} cwd`);
  const binPath = absolutePath(record.binPath, `${label} binPath`);
  const binPrefix = `${cwd}/node_modules/.bin/`;
  if (!binPath.startsWith(binPrefix) || binPath.slice(binPrefix.length).includes('/')) {
    throw new TypeError(`${label} binPath must name an installed node_modules/.bin entry`);
  }
  if (!Array.isArray(record.args)) {
    throw new TypeError(`${label} args must be a dense string array`);
  }
  const args = record.args;
  const descriptors = Object.getOwnPropertyDescriptors(args);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${label} args must be a dense string array`);
  }
  const length = (descriptors as unknown as Record<PropertyKey, PropertyDescriptor>).length;
  const indexKeys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    indexKeys.length !== length.value ||
    indexKeys.some((key, index) => key !== String(index)) ||
    indexKeys.some((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string'
      );
    })
  ) {
    throw new TypeError(`${label} args must be a dense string array`);
  }
  const copiedArgs = indexKeys.map((key) => {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`${label} args must be a dense string array`);
    }
    return descriptor.value;
  });
  return {
    record,
    request: Object.freeze({ cwd, binPath, args: Object.freeze(copiedArgs) }),
  };
}

export function validateRunBinRequest(input: ToolchainRunBinRequest): ToolchainRunBinRequest {
  return validateBinInput(input, ['args', 'binPath', 'cwd'], 'toolchain.runBin').request;
}

export function validateStartBinRequest(input: ToolchainStartBinRequest): ToolchainStartBinRequest {
  const validated = validateBinInput(
    input,
    ['args', 'binPath', 'cwd', 'port'],
    'toolchain.startBin',
  );
  const port = validated.record.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('toolchain.startBin port must be an integer from 1 through 65535');
  }
  return Object.freeze({ ...validated.request, port });
}

export function validateActivationState(input: unknown, label: string): ToolchainActivationState {
  const fields = ['bindings', 'cwd', 'files', 'vfsBackend'];
  if (input !== null && typeof input === 'object' && Object.hasOwn(input, 'directories'))
    fields.push('directories');
  const record = exactInput(input, fields, label);
  const cwd = record.cwd === '/' ? '/' : absolutePath(record.cwd, `${label} cwd`);
  if (record.vfsBackend !== 'opfs' && record.vfsBackend !== 'memory') {
    throw new TypeError(`${label} vfsBackend must be opfs or memory`);
  }
  if (!Array.isArray(record.bindings) || Object.getOwnPropertySymbols(record.bindings).length > 0) {
    throw new TypeError(`${label} bindings must be a dense array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(record.bindings);
  const indexKeys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (
    indexKeys.length !== record.bindings.length ||
    indexKeys.some((key, index) => key !== String(index)) ||
    indexKeys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !('value' in descriptor);
    })
  ) {
    throw new TypeError(`${label} bindings must be a dense array`);
  }
  const bindings = indexKeys.map((key, index) => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} bindings must be a dense array`);
    }
    const value = descriptor.value;
    const binding = exactInput(value, ['adapterId', 'packagePath'], `${label} binding ${index}`);
    if (typeof binding.adapterId !== 'string' || binding.adapterId.length === 0) {
      throw new TypeError(`${label} binding ${index} adapterId must be a non-empty string`);
    }
    const packagePath = absolutePath(binding.packagePath, `${label} binding ${index} packagePath`);
    return Object.freeze({ adapterId: binding.adapterId, packagePath });
  });
  if (!Array.isArray(record.files) || Object.getOwnPropertySymbols(record.files).length > 0) {
    throw new TypeError(`${label} files must be a dense array`);
  }
  const fileDescriptors = Object.getOwnPropertyDescriptors(record.files);
  const fileKeys = Object.keys(fileDescriptors).filter((key) => key !== 'length');
  if (
    fileKeys.length !== record.files.length ||
    fileKeys.some((key, index) => key !== String(index)) ||
    fileKeys.some((key) => {
      const descriptor = fileDescriptors[key];
      return descriptor === undefined || !('value' in descriptor);
    })
  ) {
    throw new TypeError(`${label} files must be a dense array`);
  }
  const seen = new Set<string>();
  const files = fileKeys.map((key, index) => {
    const descriptor = fileDescriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} files must be a dense array`);
    }
    const file = exactInput(descriptor.value, ['data', 'path'], `${label} file ${index}`);
    const path = absolutePath(file.path, `${label} file ${index} path`);
    if (seen.has(path)) throw new TypeError(`${label} has duplicate file ${path}`);
    seen.add(path);
    if (!(file.data instanceof Uint8Array)) {
      throw new TypeError(`${label} file ${index} data must be Uint8Array`);
    }
    return Object.freeze({ path, data: new Uint8Array(file.data) });
  });
  return Object.freeze({
    cwd,
    bindings: Object.freeze(bindings),
    vfsBackend: record.vfsBackend,
    ...(record.directories === undefined
      ? {}
      : { directories: validateDirectories(record.directories, label) }),
    files: Object.freeze(files.toSorted((left, right) => left.path.localeCompare(right.path))),
  });
}

function validateDirectories(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length)
    throw new TypeError(`${label} directories must be a dense array`);
  return Object.freeze(value.map((path) => absolutePath(path, `${label} directory`)).toSorted());
}
