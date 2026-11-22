import { sharedPool } from './pool.ts';
/**
 * A live sandbox (ADR-0568): between operations its files are rifty's
 * in-memory FS in this realm, decoded from snapshot bytes (ADR-0567); a run is
 * one pool call that restores them in a fresh isolate, runs `node <path>` and
 * hands back the end state, which replaces them only if the run ended on its
 * own. Operations take effect one at a time, in call order.
 */
import { REFUSED } from './protocol.ts';
import { type RunCodeOptions, type RunCodeResult, limit, runLimits } from './run-code.ts';

/** `dist/codec.js`: rifty's MemoryFs and the snapshot codec, bundled (`src/codec.ts`). */
interface Fs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  readdirSync(path: string): readonly { name: string; isFile: boolean; isDirectory: boolean }[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number };
}
interface Codec {
  MemoryFsSync: new () => Fs;
  GUEST_DIRS: readonly string[];
  snapshotFs(fs: Fs, options: SnapshotOptions): Uint8Array;
  restoreFs(fs: Fs, bytes: Uint8Array, options: SnapshotOptions): void;
}
interface SnapshotOptions {
  readonly template: null;
  readonly maxBytes: number;
}
// `src/` in the workspace and `dist/` when packed are both one level under the package root.
let codec: Promise<Codec> | undefined;
const loadCodec = (): Promise<Codec> =>
  (codec ??= import(new URL('../dist/codec.js', import.meta.url).href) as Promise<Codec>);

export interface SandboxOptions {
  /** Bytes of `sandbox.snapshot()` (ADR-0567): the new sandbox starts with their files. */
  readonly snapshot?: Uint8Array;
  /** Largest file one `readFile`/`writeFile` moves. Default 64 MiB. */
  readonly maxFileBytes?: number;
  /** Largest state (snapshot bytes) the sandbox keeps. Default 256 MiB. */
  readonly maxFsBytes?: number;
}

export interface ExecOptions extends RunCodeOptions {
  /** `process.argv.slice(2)` of the run. */
  readonly args?: readonly string[];
}

export interface ExecResult extends RunCodeResult {
  /**
   * The run ended on its own but its end state was not kept — the files are
   * as before it: `ERR_ISOLATE_HOST_SANDBOX_RESTORE` (its state did not fit
   * its isolate; no guest code ran), `ERR_ISOLATE_HOST_SANDBOX_CAPTURE`,
   * `ERR_FS_SNAPSHOT_TOO_LARGE` (over `maxFsBytes`) or the codec's refusal of
   * the bytes the run handed back.
   */
  readonly stateRefused?: string;
}

export interface SandboxEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
  /** Bytes; 0 for a directory. */
  readonly size: number;
}

export interface Sandbox {
  /** Write a file (parents created); a string is UTF-8. */
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  /** Entries of a directory, by name. Default `/workspace`. */
  list(path?: string): Promise<SandboxEntry[]>;
  /** Remove a file or a directory tree. */
  remove(path: string): Promise<void>;
  /** `node <path> [args]`, cwd `/workspace`. */
  exec(path: string, options?: ExecOptions): Promise<ExecResult>;
  /** The files as ADR-0567 bytes; `createSandbox({ snapshot })` restores them. */
  snapshot(): Promise<Uint8Array>;
  /** Pending, running and later operations reject `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`. */
  destroy(): Promise<void>;
}

const WORKSPACE = '/workspace';
const DESCRIPTION: Record<string, string> = {
  ENOENT: 'no such file or directory',
  EEXIST: 'file already exists',
  EISDIR: 'illegal operation on a directory',
  ENOTDIR: 'not a directory',
  ENOTEMPTY: 'directory not empty',
  EINVAL: 'invalid argument',
  ENAMETOOLONG: 'name too long',
};
/** The snapshot format's longest name (ADR-0567): a longer one could never be kept. */
const MAX_NAME = 16_383;

const coded = <E extends Error>(error: E, code: string): E & { code: string } =>
  Object.assign(error, { code });

function notImplemented(feature: string, hint: string): Error {
  const error = new Error(`Not implemented: ${feature} (${hint})`);
  error.name = 'NotImplementedError';
  return Object.assign(error, { feature });
}

/** Node's shape for a failed fs call on `path` (a sandbox path: no host text). */
function fsError(code: string, syscall: string, path: string): Error {
  const known = DESCRIPTION[code] === undefined ? 'EIO' : code;
  const text = DESCRIPTION[known] ?? 'i/o error';
  return Object.assign(new Error(`${known}: ${text}, ${syscall} '${path}'`), {
    code: known,
    syscall,
    path,
  });
}

/** Run a VFS call; its `VfsError` becomes Node's shape for `path`. */
function vfs<T>(syscall: string, path: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw fsError(typeof code === 'string' ? code : 'EIO', syscall, path);
  }
}

/** POSIX `path.resolve('/workspace', p)`; a NUL or a non-string is refused as Node does. */
function sandboxPath(p: unknown, name = 'path'): string {
  if (typeof p !== 'string')
    throw coded(
      new TypeError(`The "${name}" argument must be of type string`),
      'ERR_INVALID_ARG_TYPE',
    );
  if (p.length === 0 || p.includes('\0'))
    throw coded(
      new TypeError(`The argument '${name}' must be a non-empty string without null bytes`),
      'ERR_INVALID_ARG_VALUE',
    );
  const parts: string[] = [];
  for (const seg of `${p.startsWith('/') ? '' : WORKSPACE}/${p}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

/** A sandbox path for `syscall`; a name the snapshot cannot hold is Node's `ENAMETOOLONG`. */
function opPath(p: unknown, syscall: string): string {
  const path = sandboxPath(p);
  if (path.split('/').some((name) => name.length > MAX_NAME))
    throw fsError('ENAMETOOLONG', syscall, path);
  return path;
}

const destroyedError = (): Error =>
  coded(new Error('isolate-host sandbox: destroyed'), 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED');

const isCodec = (error: unknown): error is { code: string } =>
  typeof (error as { code?: unknown })?.code === 'string' &&
  (error as { code: string }).code.startsWith('ERR_FS_SNAPSHOT_');

class LiveSandbox implements Sandbox {
  #fs: Fs | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #abort: ((error: Error) => void) | undefined;
  #destroyed = false;
  readonly #options: SnapshotOptions;

  constructor(
    private readonly codec: Codec,
    fs: Fs,
    readonly maxFileBytes: number,
    maxFsBytes: number,
  ) {
    this.#fs = fs;
    this.#options = { template: null, maxBytes: maxFsBytes };
  }

  /** One operation, after every earlier one (ADR-0568 §4). */
  #op<T>(fn: (fs: Fs) => T | Promise<T>): Promise<T> {
    const next = this.#tail.then(() => {
      if (this.#fs === undefined || this.#destroyed) throw destroyedError();
      return fn(this.#fs);
    });
    this.#tail = next.catch(() => {});
    return next;
  }

  writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return this.#op((fs) => {
      const target = opPath(path, 'open');
      if (typeof data !== 'string' && !(data instanceof Uint8Array))
        throw coded(
          new TypeError('The "data" argument must be a string or a Uint8Array'),
          'ERR_INVALID_ARG_TYPE',
        );
      // An exact copy: the caller's buffer may change after the call.
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data.slice();
      if (bytes.byteLength > this.maxFileBytes) throw tooLarge(bytes.byteLength, this.maxFileBytes);
      const parent = target.slice(0, target.lastIndexOf('/')) || '/';
      const previous =
        fs.existsSync(target) && fs.statSync(target).isFile
          ? fs.readFileBytesSync(target)
          : undefined;
      const created = missingDirs(fs, parent);
      vfs('mkdir', parent, () => fs.mkdirSync(parent, { recursive: true }));
      vfs('open', target, () => fs.writeFileSync(target, bytes));
      try {
        this.codec.snapshotFs(fs, this.#options);
      } catch (error) {
        // Over the state cap: undo, then refuse.
        if (previous === undefined) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, previous);
        for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
        if (isCodec(error) && error.code === REFUSED[2])
          throw coded(
            new RangeError(
              `isolate-host sandbox: the sandbox is over maxFsBytes (${this.#options.maxBytes})`,
            ),
            'ERR_ISOLATE_HOST_SANDBOX_FULL',
          );
        throw error;
      }
    });
  }

  readFile(path: string): Promise<Uint8Array> {
    return this.#op((fs) => {
      const target = opPath(path, 'open');
      const stat = vfs('open', target, () => fs.statSync(target));
      if (stat.isDirectory) throw fsError('EISDIR', 'read', target);
      if ((stat.size ?? 0) > this.maxFileBytes) throw tooLarge(stat.size ?? 0, this.maxFileBytes);
      return vfs('open', target, () => fs.readFileBytesSync(target)).slice();
    });
  }

  list(path: string = WORKSPACE): Promise<SandboxEntry[]> {
    return this.#op((fs) => {
      const dir = opPath(path, 'scandir');
      const entries = vfs('scandir', dir, () => fs.readdirSync(dir));
      return entries
        .map(({ name, isDirectory }) => ({
          name,
          type: isDirectory ? ('directory' as const) : ('file' as const),
          size: isDirectory ? 0 : (fs.statSync(`${dir === '/' ? '' : dir}/${name}`).size ?? 0),
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    });
  }

  remove(path: string): Promise<void> {
    return this.#op((fs) => {
      const target = opPath(path, 'rm');
      if (!fs.existsSync(target)) throw fsError('ENOENT', 'rm', target);
      vfs('rm', target, () => fs.rmSync(target, { recursive: true }));
    });
  }

  exec(path: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.#op(async (fs) => {
      for (const option of ['env', 'cwd', 'stdin'] as const) {
        if (option in options)
          throw notImplemented(
            `isolate-host.sandbox-exec-${option}`,
            'a sandbox run is `node <path> [args]` in /workspace, ADR-0568',
          );
      }
      const entry = sandboxPath(path);
      const { args = [] } = options;
      if (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))
        throw coded(
          new TypeError('The "options.args" property must be an array of strings'),
          'ERR_INVALID_ARG_TYPE',
        );
      const limits = runLimits(options);
      const state = this.codec.snapshotFs(fs, this.#options);
      const result = await sharedPool().run(
        {
          code: '',
          ...limits,
          sandbox: {
            path: entry,
            args: [...args],
            state: Buffer.from(state.buffer, state.byteOffset, state.byteLength).toString('base64'),
            maxFsBytes: this.#options.maxBytes,
          },
        },
        (abort) => {
          this.#abort = abort;
        },
      );
      this.#abort = undefined;
      if (this.#destroyed) throw destroyedError();
      const { state: end, stateRefused, ...run } = result;
      if (stateRefused !== undefined) return { ...run, stateRefused };
      // Killed (timeout, memory): the state of before the run (ADR-0568 §3).
      if (end === undefined || run.termination !== undefined) return run;
      const next = new this.codec.MemoryFsSync();
      try {
        // The run's bytes are the guest's: they become state only through the codec's checks.
        this.codec.restoreFs(next, end, this.#options);
      } catch (error) {
        return { ...run, stateRefused: isCodec(error) ? error.code : REFUSED[1] };
      }
      this.#fs = next;
      return run;
    });
  }

  snapshot(): Promise<Uint8Array> {
    return this.#op((fs) => this.codec.snapshotFs(fs, this.#options));
  }

  destroy(): Promise<void> {
    if (!this.#destroyed) {
      this.#destroyed = true;
      this.#abort?.(destroyedError());
      this.#fs = undefined;
    }
    return this.#tail.then(() => {});
  }
}

function tooLarge(size: number, max: number): Error {
  return coded(
    new RangeError(`File size (${size}) is greater than maxFileBytes (${max})`),
    'ERR_FS_FILE_TOO_LARGE',
  );
}

/** The directories `mkdir -p dir` would create, deepest last. */
function missingDirs(fs: Fs, dir: string): string[] {
  const out: string[] = [];
  for (let d = dir; d !== '/' && !fs.existsSync(d); d = d.slice(0, d.lastIndexOf('/')) || '/')
    out.unshift(d);
  return out;
}

export async function createSandbox(options: SandboxOptions = {}): Promise<Sandbox> {
  if ('template' in options)
    throw notImplemented(
      'isolate-host.sandbox-template',
      'a sandbox starts empty or from its own snapshot, ADR-0568',
    );
  const maxFileBytes = Math.floor(limit('maxFileBytes', options.maxFileBytes, 64 << 20, 0));
  const maxFsBytes = Math.floor(limit('maxFsBytes', options.maxFsBytes, 256 << 20, 0));
  const c = await loadCodec();
  const fs = new c.MemoryFsSync();
  if (options.snapshot !== undefined) {
    if (!(options.snapshot instanceof Uint8Array))
      throw coded(
        new TypeError('The "options.snapshot" property must be a Uint8Array'),
        'ERR_INVALID_ARG_TYPE',
      );
    c.restoreFs(fs, options.snapshot.slice(), { template: null, maxBytes: maxFsBytes });
  } else for (const dir of c.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  return new LiveSandbox(c, fs, maxFileBytes, maxFsBytes);
}
