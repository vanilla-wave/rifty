import { type CallHandle, sharedPool } from './pool.ts';
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
function loadCodec(): Promise<Codec> {
  codec ??= import(new URL('../dist/codec.js', import.meta.url).href) as Promise<Codec>;
  return codec;
}

export interface SandboxOptions {
  /** Bytes of `sandbox.snapshot()` (ADR-0567): the new sandbox starts with their files. */
  readonly snapshot?: Uint8Array;
  /** Largest file one `readFile`/`writeFile` moves. Default 32 MiB. */
  readonly maxFileBytes?: number;
  /**
   * Largest state (snapshot bytes) the sandbox keeps. Default 64 MiB: a run
   * needs an isolate of about 2.3 × its state (ADR-0567), and `memoryLimitMb`
   * defaults to 256.
   */
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

/**
 * Every error leaving the sandbox API: its fields name only sandbox paths, and its
 * `stack` is its first line — no frame or path of this process reaches the model.
 */
function bare(error: unknown): unknown {
  if (error instanceof Error) error.stack = `${error.name}: ${error.message}`;
  return error;
}

/** An exact copy of any typed bytes (a `Buffer` slice would share memory). */
const copyOf = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes);

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

/** The options each entry point knows; any other name is a loud refusal (ADR-0568 §1). */
const SANDBOX_OPTIONS = new Set(['snapshot', 'maxFileBytes', 'maxFsBytes', 'template']);
const EXEC_OPTIONS = new Set([
  'args',
  'timeoutMs',
  'memoryLimitMb',
  'maxOutputBytes',
  'allowSharedArrayBuffer',
  'env',
  'cwd',
  'stdin',
]);

function knownOptions(options: object, known: Set<string>, where: string): void {
  for (const name of Object.keys(options)) {
    if (!known.has(name))
      throw coded(
        new TypeError(`The option '${name}' is not an option of ${where}`),
        'ERR_INVALID_ARG_VALUE',
      );
  }
}

/**
 * The bytes of a host write as they are at the call: an exact copy (a `Buffer`
 * slice would share memory), its size checked first so a refused input costs
 * no copy.
 */
function inputBytes(data: unknown, maxFileBytes: number): Uint8Array {
  if (typeof data !== 'string' && !(data instanceof Uint8Array))
    throw coded(
      new TypeError('The "data" argument must be a string or a Uint8Array'),
      'ERR_INVALID_ARG_TYPE',
    );
  const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
  if (size > maxFileBytes) throw tooLarge(size, maxFileBytes);
  return typeof data === 'string' ? new TextEncoder().encode(data) : copyOf(data);
}

const settle = (): void => {};

class LiveSandbox implements Sandbox {
  /**
   * The state, boxed: `destroy` drops the box, so a run that finishes after it
   * writes into a box nothing references any more — no state comes back.
   */
  #box: { fs: Fs } | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #run: CallHandle | undefined;
  /** Calls whose isolate may still be on its worker (a timed-out one keeps running a while). */
  readonly #leaving = new Set<Promise<void>>();
  #ended: Promise<void> = Promise.resolve();
  #destroyed = false;
  readonly #codec: Codec;
  readonly #maxFileBytes: number;
  readonly #options: SnapshotOptions;

  constructor(codec: Codec, fs: Fs, maxFileBytes: number, maxFsBytes: number) {
    this.#codec = codec;
    this.#box = { fs };
    this.#maxFileBytes = maxFileBytes;
    this.#options = { template: null, maxBytes: maxFsBytes };
  }

  /** One operation, after every earlier one (ADR-0568 §4). The queue keeps no result. */
  #op<T>(fn: (box: { fs: Fs }) => T | Promise<T>): Promise<T> {
    const next = this.#tail
      .then(() => {
        if (this.#box === undefined || this.#destroyed) throw destroyedError();
        return fn(this.#box);
      })
      .catch((error: unknown) => {
        throw bare(error);
      });
    this.#tail = next.then(settle, settle);
    return next;
  }

  /** An op whose input failed validation at the call: it rejects in its turn. */
  #refused(error: unknown): Promise<never> {
    return this.#op(() => {
      throw error;
    });
  }

  writeFile(path: string, data: Uint8Array | string): Promise<void> {
    let bytes: Uint8Array;
    try {
      // The bytes at the call, not when the op reaches its turn.
      bytes = inputBytes(data, this.#maxFileBytes);
    } catch (error) {
      return this.#refused(error);
    }
    return this.#op(({ fs }) => {
      const target = opPath(path, 'open');
      const parent = target.slice(0, target.lastIndexOf('/')) || '/';
      const previous =
        fs.existsSync(target) && fs.statSync(target).isFile
          ? fs.readFileBytesSync(target)
          : undefined;
      const created = firstMissingDir(fs, parent);
      vfs('mkdir', parent, () => fs.mkdirSync(parent, { recursive: true }));
      vfs('open', target, () => fs.writeFileSync(target, bytes));
      try {
        this.#codec.snapshotFs(fs, this.#options);
      } catch (error) {
        // Over the state cap: undo, then refuse.
        if (previous === undefined) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, previous);
        if (created !== undefined) fs.rmSync(created, { recursive: true, force: true });
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
    return this.#op(({ fs }) => {
      const target = opPath(path, 'open');
      const stat = vfs('open', target, () => fs.statSync(target));
      if (stat.isDirectory) throw fsError('EISDIR', 'read', target);
      if ((stat.size ?? 0) > this.#maxFileBytes) throw tooLarge(stat.size ?? 0, this.#maxFileBytes);
      return copyOf(vfs('open', target, () => fs.readFileBytesSync(target)));
    });
  }

  list(path: string = WORKSPACE): Promise<SandboxEntry[]> {
    return this.#op(({ fs }) => {
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
    return this.#op(({ fs }) => {
      const target = opPath(path, 'rm');
      if (!fs.existsSync(target)) throw fsError('ENOENT', 'rm', target);
      vfs('rm', target, () => fs.rmSync(target, { recursive: true }));
    });
  }

  exec(path: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.#op(async (box) => {
      knownOptions(options, EXEC_OPTIONS, 'exec');
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
      // Encoded per attempt (a rerun encodes the same files again): the call keeps no copy.
      const fs = box.fs;
      const state = (): Uint8Array => this.#codec.snapshotFs(fs, this.#options);
      let handle: CallHandle | undefined;
      const result = await sharedPool().run(
        {
          code: '',
          ...limits,
          sandbox: { path: entry, args: [...args], state, maxFsBytes: this.#options.maxBytes },
        },
        (h) => {
          handle = h;
          this.#run = h;
        },
      );
      this.#run = undefined;
      // A timed-out isolate may still be stopping: destroy waits for it to leave its worker.
      if (handle !== undefined) {
        const gone = handle.left();
        this.#leaving.add(gone);
        void gone.then(() => this.#leaving.delete(gone));
      }
      const { state: end, stateRefused, ...run } = result;
      if (stateRefused !== undefined) return { ...run, stateRefused };
      // Killed (timeout, memory): the state of before the run (ADR-0568 §3).
      if (end === undefined || run.termination !== undefined) return run;
      const next = new this.#codec.MemoryFsSync();
      try {
        // The run's bytes are the guest's: they become state only through the codec's checks.
        this.#codec.restoreFs(next, end, this.#options);
      } catch (error) {
        return { ...run, stateRefused: isCodec(error) ? error.code : REFUSED[1] };
      }
      box.fs = next;
      return run;
    });
  }

  snapshot(): Promise<Uint8Array> {
    return this.#op(({ fs }) => copyOf(this.#codec.snapshotFs(fs, this.#options)));
  }

  destroy(): Promise<void> {
    if (!this.#destroyed) {
      this.#destroyed = true;
      // The run in flight is cancelled; resolves once it has left its worker.
      this.#ended = this.#run?.abort(destroyedError()) ?? Promise.resolve();
      this.#box = undefined;
    }
    // Every isolate of this sandbox gone, the cancelled one and any still stopping.
    return this.#tail.then(() => Promise.all([this.#ended, ...this.#leaving])).then(settle);
  }
}

function tooLarge(size: number, max: number): Error {
  return coded(
    new RangeError(`File size (${size}) is greater than maxFileBytes (${max})`),
    'ERR_FS_FILE_TOO_LARGE',
  );
}

/**
 * The highest directory `mkdir -p dir` would create, if any. Existence along a
 * path is monotone (present, then absent), so a binary search keeps a deep
 * path at O(depth · log depth) VFS lookups instead of O(depth²).
 */
function firstMissingDir(fs: Fs, dir: string): string | undefined {
  const parts = dir.split('/').filter(Boolean);
  const at = (n: number): string => `/${parts.slice(0, n).join('/')}`;
  let lo = 0; // at(lo) exists ('/' always does)
  let hi = parts.length + 1; // at(hi) does not exist, or past the end
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fs.existsSync(at(mid))) lo = mid;
    else hi = mid;
  }
  return hi <= parts.length ? at(hi) : undefined;
}

export function createSandbox(options: SandboxOptions = {}): Promise<Sandbox> {
  let snapshot: Uint8Array | undefined;
  try {
    knownOptions(options, SANDBOX_OPTIONS, 'createSandbox');
    if ('template' in options)
      throw notImplemented(
        'isolate-host.sandbox-template',
        'a sandbox starts empty or from its own snapshot, ADR-0568',
      );
    const maxFsBytes = Math.floor(limit('maxFsBytes', options.maxFsBytes, 64 << 20, 0));
    if (options.snapshot !== undefined) {
      if (!(options.snapshot instanceof Uint8Array))
        throw coded(
          new TypeError('The "options.snapshot" property must be a Uint8Array'),
          'ERR_INVALID_ARG_TYPE',
        );
      if (options.snapshot.byteLength > maxFsBytes)
        throw coded(
          new RangeError(`isolate-host sandbox: the snapshot is over maxFsBytes (${maxFsBytes})`),
          'ERR_FS_SNAPSHOT_TOO_LARGE',
        );
      // The bytes at the call: the caller may change its buffer while the codec loads.
      snapshot = copyOf(options.snapshot);
    }
  } catch (error) {
    return Promise.reject(bare(error));
  }
  return open(options, snapshot).catch((error: unknown) => {
    throw bare(error);
  });
}

async function open(options: SandboxOptions, snapshot: Uint8Array | undefined): Promise<Sandbox> {
  const maxFileBytes = Math.floor(limit('maxFileBytes', options.maxFileBytes, 32 << 20, 0));
  const maxFsBytes = Math.floor(limit('maxFsBytes', options.maxFsBytes, 64 << 20, 0));
  const c = await loadCodec();
  const fs = new c.MemoryFsSync();
  if (snapshot !== undefined) c.restoreFs(fs, snapshot, { template: null, maxBytes: maxFsBytes });
  else for (const dir of c.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  return new LiveSandbox(c, fs, maxFileBytes, maxFsBytes);
}
