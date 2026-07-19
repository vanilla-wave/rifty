import { NotImplementedError } from '@riftydev/io';
import type { SyncRpcDispatcher } from '@riftydev/kernel';
import { FS_RPC_CHUNK } from '@riftydev/runtime-js';
import { VfsError, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import type { PathVersion, TreeRevision } from '../workbench/project-vfs-contract.ts';
import {
  VITE_CONFIG_TEMP_CACHE_CAPABILITY,
  VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY,
  VITE_CONFIG_TEMP_CACHE_METHODS,
  type ViteConfigTempCacheAdmissionMessage,
} from './vite-config-temp-cache-protocol.ts';

interface PendingFile {
  readonly path: string;
  readonly size: number;
  readonly chunks: Map<number, Uint8Array>;
  written: number;
  committed: boolean;
}

interface Generation {
  readonly token: string;
  readonly projectRoot: string;
  readonly sourcePath: string;
  readonly sourceBytes: Uint8Array;
  readonly sourceVersion: PathVersion;
  readonly treeRevision: TreeRevision;
  readonly logicalDirectories: Set<string>;
  readonly files: Map<string, PendingFile>;
  liveBytes: number;
}

interface CacheAccess {
  readonly treeRevision: TreeRevision;
  versionOf(path: string): PathVersion | null;
  readFileBytesSync(path: string): Uint8Array;
}

export interface OwnerViteConfigTempCacheSession {
  readonly capabilityPorts: Readonly<Record<string, MessagePort>>;
  dispose(): void;
}

export interface OwnerViteConfigTempCacheProject {
  admit(relativeSourcePath: string): OwnerViteConfigTempCacheSession;
  close(): void;
}

export interface OwnerViteConfigTempCacheAuthority {
  install(dispatcher: SyncRpcDispatcher): void;
  createProject(projectRoot: string): OwnerViteConfigTempCacheProject;
  close(): void;
}

function object(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, owner: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${owner} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, owner: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${owner} must be a non-negative safe integer`);
  }
  return value as number;
}

function absolute(value: unknown, owner: string): string {
  const path = string(value, owner);
  if (!isAbsolute(path) || normalizePath(path) !== path) {
    throw new TypeError(`${owner} must be an absolute normalized path`);
  }
  return path;
}

function canonicalRoot(value: string): string {
  if (!isAbsolute(value) || normalizePath(value) !== value) {
    throw new TypeError(
      `Vite config temp-cache project root must be absolute and normalized: ${value}`,
    );
  }
  return value;
}

function canonicalRelative(value: string): string {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    normalizePath(`/${value}`) !== `/${value}` ||
    !value.startsWith('node_modules/vite/dist/node/chunks/') ||
    !value.endsWith('.js')
  ) {
    throw new TypeError(`Invalid prepared Vite config-loader path: ${value}`);
  }
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Vite config temp-cache requires cryptographic admission identities');
  }
  return globalThis.crypto.randomUUID();
}

function decodeBase64(value: unknown): Uint8Array {
  const encoded = string(value, 'Vite config temp-cache chunk');
  let binary: string;
  try {
    binary = atob(encoded);
  } catch (cause) {
    throw new TypeError('Vite config temp-cache chunk must be valid base64', { cause });
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requestFor(
  generations: Map<string, Generation>,
  raw: unknown,
): { readonly request: Record<string, unknown>; readonly generation: Generation } {
  const request = object(raw, 'Vite config temp-cache request');
  const token = string(request.token, 'Vite config temp-cache token');
  const generation = generations.get(token);
  if (generation === undefined) {
    throw new Error('Vite config temp-cache admission is retired or invalid');
  }
  return { request, generation };
}

function fileFor(generation: Generation, value: unknown): PendingFile {
  const path = absolute(value, 'Vite config temp-cache path');
  const file = generation.files.get(path);
  if (file === undefined) throw new VfsError('ENOENT', path);
  return file;
}

function isLogicalTempDirectory(path: string): boolean {
  return path === '/node_modules/.vite-temp' || path.endsWith('/node_modules/.vite-temp');
}

function isTimestampedConfigModule(path: string): boolean {
  // Vite uses Math.random().toString(16).slice(2); Math.random() === 0 yields
  // an empty suffix and is valid upstream behavior.
  return /\.timestamp-[0-9]+-[0-9a-f]*\.mjs$/u.test(path);
}

function parent(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator <= 0 ? '/' : path.slice(0, separator);
}

function validateGeneratedPath(generation: Generation, path: string): void {
  if (!isTimestampedConfigModule(path)) {
    throw new VfsError('EPERM', path, `EPERM: invalid Vite generated config module path: ${path}`);
  }
  const directory = parent(path);
  if (isLogicalTempDirectory(directory) && generation.logicalDirectories.has(directory)) return;
  // Upstream's EACCES fallback writes beside the user config. The exact Vite
  // binding is the only caller; keep the original path but never expose it in VFS.
  if (!path.includes('/node_modules/')) return;
  throw new VfsError('EPERM', path, `EPERM: unadmitted Vite config temp-cache path: ${path}`);
}

function release(generation: Generation, path: string): void {
  const file = generation.files.get(path);
  if (file === undefined) return;
  generation.files.delete(path);
  generation.liveBytes -= file.size;
}

/** Internal subordinate whose lifecycle and only public ingress are owned by OwnerVfsAuthority. */
export function createOwnerVfsViteConfigTempCache(
  access: CacheAccess,
): OwnerViteConfigTempCacheAuthority {
  const generations = new Map<string, Generation>();
  const projectTokens = new Map<string, Set<string>>();
  const installedDispatchers = new Set<SyncRpcDispatcher>();
  let closed = false;

  const retireToken = (token: string): void => {
    const generation = generations.get(token);
    if (generation === undefined) return;
    generation.files.clear();
    generation.logicalDirectories.clear();
    generation.liveBytes = 0;
    generations.delete(token);
    const tokens = projectTokens.get(generation.projectRoot);
    tokens?.delete(token);
    if (tokens?.size === 0) projectTokens.delete(generation.projectRoot);
  };

  const install = (dispatcher: SyncRpcDispatcher): void => {
    if (closed) throw new Error('Vite config temp-cache authority is closed');
    if (installedDispatchers.has(dispatcher)) return;
    installedDispatchers.add(dispatcher);

    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.scope, (raw) => {
      const { generation } = requestFor(generations, raw);
      return {
        sourcePath: generation.sourcePath,
        sourceSize: generation.sourceBytes.byteLength,
        sourceVersion: generation.sourceVersion,
        treeRevision: generation.treeRevision,
      };
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.sourceRead, (raw): Uint8Array => {
      const { request, generation } = requestFor(generations, raw);
      const offset = integer(request.offset, 'Vite config temp-cache source offset');
      const length = integer(request.length, 'Vite config temp-cache source length');
      if (length > FS_RPC_CHUNK) {
        throw new RangeError('Vite config temp-cache source read exceeds the sync-ring bound');
      }
      return generation.sourceBytes.slice(offset, offset + length);
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.mkdir, (raw): null => {
      const { request, generation } = requestFor(generations, raw);
      const path = absolute(request.path, 'Vite config temp-cache directory');
      if (request.recursive !== true || !isLogicalTempDirectory(path)) {
        throw new VfsError(
          'EPERM',
          path,
          `EPERM: invalid Vite config temp-cache directory: ${path}`,
        );
      }
      generation.logicalDirectories.add(path);
      return null;
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.begin, (raw): null => {
      const { request, generation } = requestFor(generations, raw);
      const path = absolute(request.path, 'Vite config temp-cache path');
      validateGeneratedPath(generation, path);
      const size = integer(request.size, 'Vite config temp-cache size');
      const existing = generation.files.get(path);
      const retained = generation.liveBytes - (existing?.size ?? 0);
      if (size > VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY - retained) {
        throw new NotImplementedError(
          'playground.vite-config-temp-cache.capacity',
          `requested ${String(size)} bytes with ${String(retained)} live; limit ${String(VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY)}`,
        );
      }
      if (existing !== undefined) release(generation, path);
      generation.files.set(path, {
        path,
        size,
        chunks: new Map(),
        written: 0,
        committed: false,
      });
      generation.liveBytes += size;
      return null;
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.write, (raw): null => {
      const { request, generation } = requestFor(generations, raw);
      const file = fileFor(generation, request.path);
      if (file.committed) throw new Error(`Vite config temp-cache file is committed: ${file.path}`);
      const offset = integer(request.offset, 'Vite config temp-cache write offset');
      if (offset !== file.written) {
        throw new Error(
          `Vite config temp-cache chunk offset mismatch for ${file.path}: expected ${String(file.written)}, got ${String(offset)}`,
        );
      }
      const bytes = decodeBase64(request.bytes);
      if (bytes.byteLength > FS_RPC_CHUNK) {
        throw new RangeError('Vite config temp-cache chunk exceeds the sync-ring bound');
      }
      if (file.written + bytes.byteLength > file.size) {
        throw new RangeError(
          `Vite config temp-cache upload exceeds declared size for ${file.path}`,
        );
      }
      file.chunks.set(offset, bytes);
      file.written += bytes.byteLength;
      return null;
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.commit, (raw): null => {
      const { request, generation } = requestFor(generations, raw);
      const file = fileFor(generation, request.path);
      if (file.written !== file.size) {
        throw new Error(
          `Vite config temp-cache upload is incomplete for ${file.path}: ${String(file.written)}/${String(file.size)}`,
        );
      }
      file.committed = true;
      return null;
    });
    dispatcher.register(
      VITE_CONFIG_TEMP_CACHE_METHODS.inspect,
      (raw): { readonly size: number } | null => {
        const { request, generation } = requestFor(generations, raw);
        const path = absolute(request.path, 'Vite config temp-cache path');
        const file = generation.files.get(path);
        return file?.committed === true ? { size: file.size } : null;
      },
    );
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.read, (raw): Uint8Array => {
      const { request, generation } = requestFor(generations, raw);
      const file = fileFor(generation, request.path);
      if (!file.committed) throw new VfsError('ENOENT', file.path);
      const offset = integer(request.offset, 'Vite config temp-cache read offset');
      const length = integer(request.length, 'Vite config temp-cache read length');
      if (length > FS_RPC_CHUNK) {
        throw new RangeError('Vite config temp-cache read exceeds the sync-ring bound');
      }
      if (offset >= file.size) return new Uint8Array(0);
      const chunk = file.chunks.get(offset);
      if (chunk === undefined) {
        throw new Error(
          `Vite config temp-cache read offset is not a chunk boundary: ${String(offset)}`,
        );
      }
      return chunk.slice(0, length);
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.remove, (raw): null => {
      const { request, generation } = requestFor(generations, raw);
      release(generation, absolute(request.path, 'Vite config temp-cache path'));
      return null;
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.abort, (raw): null => {
      const { request, generation } = requestFor(generations, raw);
      release(generation, absolute(request.path, 'Vite config temp-cache path'));
      return null;
    });
    dispatcher.register(VITE_CONFIG_TEMP_CACHE_METHODS.retire, (raw): null => {
      const { generation } = requestFor(generations, raw);
      retireToken(generation.token);
      return null;
    });
  };

  return Object.freeze({
    install,
    createProject(projectRootValue: string): OwnerViteConfigTempCacheProject {
      if (closed) throw new Error('Vite config temp-cache authority is closed');
      const projectRoot = canonicalRoot(projectRootValue);
      let projectClosed = false;
      return Object.freeze({
        admit(relativeSourcePathValue: string): OwnerViteConfigTempCacheSession {
          if (projectClosed || closed) throw new Error('Vite config temp-cache project is closed');
          const relativeSourcePath = canonicalRelative(relativeSourcePathValue);
          const physicalSourcePath = joinPath(projectRoot, relativeSourcePath);
          const sourceVersion = access.versionOf(physicalSourcePath);
          if (sourceVersion === null) {
            throw new Error(
              `Prepared Vite config-loader source is not owner-attested: ${physicalSourcePath}`,
            );
          }
          const sourceBytes = access.readFileBytesSync(physicalSourcePath).slice();
          if (
            access.versionOf(physicalSourcePath) !== sourceVersion ||
            !bytesEqual(access.readFileBytesSync(physicalSourcePath), sourceBytes)
          ) {
            throw new Error(
              `Prepared Vite config-loader source changed during admission: ${physicalSourcePath}`,
            );
          }
          const token = uuid();
          const generation: Generation = {
            token,
            projectRoot,
            sourcePath: `/${relativeSourcePath}`,
            sourceBytes,
            sourceVersion,
            treeRevision: access.treeRevision,
            logicalDirectories: new Set(),
            files: new Map(),
            liveBytes: 0,
          };
          generations.set(token, generation);
          const tokens = projectTokens.get(projectRoot) ?? new Set<string>();
          tokens.add(token);
          projectTokens.set(projectRoot, tokens);
          const channel = new MessageChannel();
          const admission: ViteConfigTempCacheAdmissionMessage = {
            type: 'workbench:vite-config-temp-cache-admission',
            token,
          };
          channel.port1.postMessage(admission);
          channel.port1.close();
          let disposed = false;
          return Object.freeze({
            capabilityPorts: Object.freeze({
              [VITE_CONFIG_TEMP_CACHE_CAPABILITY]: channel.port2,
            }),
            dispose(): void {
              if (disposed) return;
              disposed = true;
              retireToken(token);
              channel.port2.close();
            },
          });
        },
        close(): void {
          if (projectClosed) return;
          projectClosed = true;
          for (const token of [...(projectTokens.get(projectRoot) ?? [])]) retireToken(token);
        },
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      for (const token of [...generations.keys()]) retireToken(token);
      for (const dispatcher of installedDispatchers) {
        for (const method of Object.values(VITE_CONFIG_TEMP_CACHE_METHODS)) {
          dispatcher.unregister(method);
        }
      }
    },
  });
}
