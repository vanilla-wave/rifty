import { FS_RPC_CHUNK, type SyncCall } from '@riftydev/runtime-js';
import type { ExactEsmModuleBinding } from '@riftydev/runtime-js/builtins/node-entry';
import { type FsSync, isAbsolute, normalizePath } from '@riftydev/vfs';
import {
  VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS,
  VITE_CONFIG_TEMP_CACHE_BINDING,
  VITE_CONFIG_TEMP_CACHE_METHODS,
  inspectViteConfigTempCacheAdmissionMessage,
} from './vite-config-temp-cache-protocol.ts';

export interface ViteConfigTempFs {
  mkdir(path: string, options: { readonly recursive: true }): Promise<string | undefined>;
  writeFile(path: string, data: string): Promise<void>;
  unlink(path: string, callback: (error: Error | null) => void): void;
}

export interface InstalledViteConfigTempCacheClient {
  readonly loaderFs: FsSync;
  readonly exactEsmModuleBinding: ExactEsmModuleBinding;
  readonly vitePackageRoot: string;
}

const SafeUint8Array = Uint8Array;
const SafeError = Error;
const SafeTypeError = TypeError;
const SafeAggregateError = AggregateError;
const encodeUtf8 = TextEncoder.prototype.encode.bind(new TextEncoder());
const safeQueueMicrotask = queueMicrotask.bind(globalThis);
const safeObjectCreate = Object.create.bind(Object);
const safeObjectKeys = Object.keys.bind(Object);
const safeMathMin = Math.min.bind(Math);
const safeIsSafeInteger = Number.isSafeInteger.bind(Number);
const safeFromCharCode = String.fromCharCode.bind(String);
const safeString = String;
const safeBtoa = btoa.bind(globalThis);
const safeUint8ArraySet = Uint8Array.prototype.set;
const safeUint8ArraySlice = Uint8Array.prototype.slice;

function payload(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out = safeObjectCreate(null) as Record<string, unknown>;
  for (const key of safeObjectKeys(fields)) out[key] = fields[key];
  return out;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += safeFromCharCode(bytes[index] as number);
  }
  return safeBtoa(binary);
}

function absolute(path: string): string {
  if (!isAbsolute(path) || normalizePath(path) !== path) {
    throw new SafeTypeError(`Vite config temp-cache path must be absolute and normalized: ${path}`);
  }
  return path;
}

async function consumeToken(port: MessagePort): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.onmessage = null;
      port.onmessageerror = null;
      port.close();
      action();
    };
    port.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const admission = inspectViteConfigTempCacheAdmissionMessage(event.data);
        settle(() => resolve(admission.token));
      } catch (error) {
        settle(() => reject(error));
      }
    };
    port.onmessageerror = () => {
      settle(() =>
        reject(new SafeError('Vite config temp-cache admission message could not decode')),
      );
    };
    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new SafeError(
            `Vite config temp-cache admission timed out after ${safeString(VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS)}ms`,
          ),
        ),
      );
    }, VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS);
    port.start();
  });
}

class ViteConfigTempCacheLoaderFs implements FsSync {
  readonly #known = new Set<string>();

  constructor(
    readonly base: FsSync,
    readonly call: SyncCall,
    readonly token: string,
  ) {}

  remember(path: string): void {
    this.#known.add(path);
  }

  forget(path: string): void {
    this.#known.delete(path);
  }

  #inspect(pathValue: string): { readonly size: number } | null {
    const path = absolute(pathValue);
    if (!this.#known.has(path)) return null;
    return this.call(
      VITE_CONFIG_TEMP_CACHE_METHODS.inspect,
      payload({ token: this.token, path }),
    ) as { readonly size: number } | null;
  }

  existsSync(path: string): boolean {
    return this.#inspect(path) !== null || this.base.existsSync(path);
  }

  statSync(path: string): ReturnType<FsSync['statSync']> {
    const cached = this.#inspect(path);
    return cached === null
      ? this.base.statSync(path)
      : { isFile: true, isDirectory: false, size: cached.size, mtime: 0 };
  }

  statSyncOrNull(path: string): ReturnType<FsSync['statSyncOrNull']> {
    const cached = this.#inspect(path);
    return cached === null
      ? this.base.statSyncOrNull(path)
      : { isFile: true, isDirectory: false, size: cached.size, mtime: 0 };
  }

  readFileBytesSync(pathValue: string): Uint8Array {
    const path = absolute(pathValue);
    const cached = this.#inspect(path);
    if (cached === null) return this.base.readFileBytesSync(path);
    const out = new SafeUint8Array(cached.size);
    for (let offset = 0; offset < out.byteLength; offset += FS_RPC_CHUNK) {
      const length = safeMathMin(FS_RPC_CHUNK, out.byteLength - offset);
      const chunk = this.call(
        VITE_CONFIG_TEMP_CACHE_METHODS.read,
        payload({ token: this.token, path, offset, length }),
      ) as Uint8Array;
      if (!(chunk instanceof SafeUint8Array) || chunk.byteLength !== length) {
        throw new SafeError(
          `Vite config temp-cache short read for ${path} at ${String(offset)}: ${String(chunk.byteLength)}/${String(length)}`,
        );
      }
      safeUint8ArraySet.call(out, chunk, offset);
    }
    return out;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    this.base.writeFileSync(path, data);
  }

  readdirSync(path: string): ReturnType<FsSync['readdirSync']> {
    return this.base.readdirSync(path);
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.base.mkdirSync(path, options);
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.base.rmSync(path, options);
  }

  renameSync(source: string, target: string): void {
    this.base.renameSync(source, target);
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.base.utimes(path, atimeMs, mtimeMs);
  }

  copyFileSync(source: string, target: string): void {
    this.base.copyFileSync(source, target);
  }

  cpSync(source: string, target: string, options?: { recursive?: boolean }): void {
    this.base.cpSync(source, target, options);
  }
}

/** Consume one one-shot entry port, then use only token-authenticated sync calls. */
export async function installViteConfigTempCacheClient(options: {
  readonly port: MessagePort;
  readonly call: SyncCall;
  readonly base: FsSync;
}): Promise<InstalledViteConfigTempCacheClient> {
  const token = await consumeToken(options.port);
  const rawScope = options.call(VITE_CONFIG_TEMP_CACHE_METHODS.scope, payload({ token })) as Record<
    string,
    unknown
  >;
  if (typeof rawScope.sourcePath !== 'string') {
    throw new SafeTypeError('Vite config temp-cache source path must be a string');
  }
  const sourcePath = absolute(rawScope.sourcePath);
  const viteChunks = '/node_modules/vite/dist/node/chunks/';
  const chunksOffset = sourcePath.indexOf(viteChunks);
  if (chunksOffset < 0 || !sourcePath.endsWith('.js')) {
    throw new SafeTypeError(
      `Vite config temp-cache source is outside the exact package chunks: ${sourcePath}`,
    );
  }
  const vitePackageRoot = sourcePath.slice(0, chunksOffset + '/node_modules/vite'.length);
  const sourceSize = rawScope.sourceSize;
  if (typeof sourceSize !== 'number' || !safeIsSafeInteger(sourceSize) || sourceSize < 0) {
    throw new SafeTypeError('Vite config temp-cache source size must be a non-negative integer');
  }
  if (typeof rawScope.sourceVersion !== 'string' || rawScope.sourceVersion.length === 0) {
    throw new SafeTypeError('Vite config temp-cache source version must be non-empty');
  }
  if (
    typeof rawScope.treeRevision !== 'number' ||
    !safeIsSafeInteger(rawScope.treeRevision) ||
    rawScope.treeRevision < 0
  ) {
    throw new SafeTypeError('Vite config temp-cache tree revision must be a non-negative integer');
  }
  const sourceBytes = new SafeUint8Array(sourceSize);
  for (let offset = 0; offset < sourceSize; offset += FS_RPC_CHUNK) {
    const length = safeMathMin(FS_RPC_CHUNK, sourceSize - offset);
    const chunk = options.call(
      VITE_CONFIG_TEMP_CACHE_METHODS.sourceRead,
      payload({ token, offset, length }),
    ) as Uint8Array;
    if (!(chunk instanceof SafeUint8Array) || chunk.byteLength !== length) {
      throw new SafeError(
        `Vite config temp-cache source short read at ${String(offset)}: ${String(chunk.byteLength)}/${String(length)}`,
      );
    }
    safeUint8ArraySet.call(sourceBytes, chunk, offset);
  }

  const loaderFs = new ViteConfigTempCacheLoaderFs(options.base, options.call, token);
  const client: ViteConfigTempFs = Object.freeze({
    async mkdir(pathValue: string, mkdirOptions: { readonly recursive: true }): Promise<undefined> {
      const path = absolute(pathValue);
      options.call(
        VITE_CONFIG_TEMP_CACHE_METHODS.mkdir,
        payload({ token, path, recursive: mkdirOptions.recursive }),
      );
      return undefined;
    },
    async writeFile(pathValue: string, data: string): Promise<void> {
      const path = absolute(pathValue);
      const bytes = encodeUtf8(data);
      try {
        options.call(
          VITE_CONFIG_TEMP_CACHE_METHODS.begin,
          payload({ token, path, size: bytes.byteLength }),
        );
        for (let offset = 0; offset < bytes.byteLength; offset += FS_RPC_CHUNK) {
          const chunk = safeUint8ArraySlice.call(bytes, offset, offset + FS_RPC_CHUNK);
          options.call(
            VITE_CONFIG_TEMP_CACHE_METHODS.write,
            payload({ token, path, offset, bytes: base64(chunk) }),
          );
        }
        options.call(VITE_CONFIG_TEMP_CACHE_METHODS.commit, payload({ token, path }));
        loaderFs.remember(path);
      } catch (error) {
        try {
          options.call(VITE_CONFIG_TEMP_CACHE_METHODS.abort, payload({ token, path }));
        } catch (abortError) {
          try {
            options.call(VITE_CONFIG_TEMP_CACHE_METHODS.retire, payload({ token }));
          } catch (retireError) {
            throw new SafeAggregateError(
              [error, abortError, retireError],
              `Vite config temp-cache upload, abort, and retirement failed for ${path}`,
            );
          }
          throw new SafeAggregateError(
            [error, abortError],
            `Vite config temp-cache upload and abort failed for ${path}; generation retired`,
          );
        }
        throw error;
      }
    },
    unlink(pathValue: string, callback: (error: Error | null) => void): void {
      const path = absolute(pathValue);
      safeQueueMicrotask(() => {
        let failure: Error | null = null;
        try {
          options.call(VITE_CONFIG_TEMP_CACHE_METHODS.remove, payload({ token, path }));
          loaderFs.forget(path);
        } catch (error) {
          failure = error instanceof SafeError ? error : new SafeError(safeString(error));
        }
        callback(failure);
      });
    },
  });

  return Object.freeze({
    loaderFs,
    vitePackageRoot,
    exactEsmModuleBinding: Object.freeze({
      path: sourcePath,
      sourceBytes,
      imports: Object.freeze({ [VITE_CONFIG_TEMP_CACHE_BINDING]: client }),
    }),
  });
}
