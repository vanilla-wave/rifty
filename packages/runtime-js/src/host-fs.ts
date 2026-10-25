import type {
  FsOperation,
  FsReadEncoding,
  FsResult,
  RuntimeEffects,
  RuntimeFsDirent,
  RuntimeFsStat,
  SerializedRuntimeError,
} from './protocol.ts';

/** Worker VFS RPC. Relative paths anchor at `/`, independent of guest cwd.
 * Writes create parents and await checked persistence. New mutations/flush
 * return receipts; errors may carry `effects`. Peer loss means unknown effects.
 * Stat/dirent are plain VFS records, not Node Stats/Dirent instances. */
export interface RuntimeFs {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: FsReadEncoding): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<readonly RuntimeFsDirent[]>;
  stat(path: string): Promise<RuntimeFsStat>;
  mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<RuntimeEffects>;
  rename(sourcePath: string, targetPath: string): Promise<RuntimeEffects>;
  rm(
    path: string,
    options?: { readonly recursive?: boolean; readonly force?: boolean },
  ): Promise<RuntimeEffects>;
  flush(): Promise<RuntimeEffects>;
}

export function deserializeRuntimeError(
  error: SerializedRuntimeError,
): Error & SerializedRuntimeError {
  const result = new Error(error.message);
  return Object.assign(result, error);
}

/** One typed client for raw and project-scoped transports. */
export function createRuntimeFs(request: (operation: FsOperation) => Promise<FsResult>): RuntimeFs {
  async function value(operation: FsOperation) {
    const result = await request(operation);
    if (!result.ok) throw deserializeRuntimeError(result.error);
    return result.value;
  }
  async function receipt(operation: FsOperation): Promise<RuntimeEffects> {
    const result = await value(operation);
    if (
      result !== null &&
      typeof result === 'object' &&
      'applied' in result &&
      'persistence' in result
    )
      return result;
    throw new Error('Invalid filesystem receipt');
  }
  function readFile(path: string): Promise<Uint8Array>;
  function readFile(path: string, encoding: FsReadEncoding): Promise<string>;
  async function readFile(path: string, encoding?: FsReadEncoding): Promise<string | Uint8Array> {
    const result = await value({
      op: 'readFile',
      path,
      ...(encoding === undefined ? {} : { encoding }),
    });
    if (encoding === undefined && result instanceof Uint8Array) return result;
    if (encoding !== undefined && typeof result === 'string') return result;
    throw new Error('Invalid filesystem read response');
  }
  return {
    readFile,
    async writeFile(path, data) {
      if (typeof data !== 'string' && !(data instanceof Uint8Array))
        throw new TypeError('fs.writeFile data must be string or Uint8Array');
      await value({
        op: 'writeFile',
        path,
        data: typeof data === 'string' ? data : new Uint8Array(data),
      });
    },
    async readdir(path) {
      const result = await value({ op: 'readdir', path });
      if (Array.isArray(result)) return result;
      throw new Error('Invalid filesystem directory response');
    },
    async stat(path) {
      const result = await value({ op: 'stat', path });
      if (
        result !== null &&
        typeof result === 'object' &&
        'isFile' in result &&
        'isDirectory' in result
      )
        return result;
      throw new Error('Invalid filesystem stat response');
    },
    mkdir: (path, options) =>
      receipt({ op: 'mkdir', path, ...(options === undefined ? {} : { options }) }),
    rename: (sourcePath, targetPath) => receipt({ op: 'rename', sourcePath, targetPath }),
    rm: (path, options) =>
      receipt({ op: 'rm', path, ...(options === undefined ? {} : { options }) }),
    flush: () => receipt({ op: 'flush' }),
  };
}
