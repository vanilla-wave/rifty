import { addAbortListener } from 'node:events';
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
  statSync(path: string): {
    isFile: boolean;
    isDirectory: boolean;
    size?: number;
    mtime?: number;
    atime?: number;
    metadata?: { ctime: number; birthtime: number };
  };
  restoreStatSync(path: string, stat: EntryTimes): void;
}
interface EntryTimes {
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
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

/** The options of a host op. */
export interface OpOptions {
  /** Aborted before the op starts: it rejects Node's `AbortError` and never takes effect. */
  readonly signal?: AbortSignal;
}

export interface ExecOptions extends RunCodeOptions {
  /** `process.argv.slice(2)` of the run. */
  readonly args?: readonly string[];
  /**
   * Aborted before the run's result is out: `exec` rejects Node's `AbortError`
   * at once, the run's isolate is disposed as at a deadline and the files stay
   * those of before the run; the sandbox stays usable.
   */
  readonly signal?: AbortSignal;
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
  writeFile(path: string, data: Uint8Array | string, options?: OpOptions): Promise<void>;
  readFile(path: string, options?: OpOptions): Promise<Uint8Array>;
  /** Entries of a directory, by name. Default `/workspace`. */
  list(path?: string, options?: OpOptions): Promise<SandboxEntry[]>;
  /** Remove a file or a directory tree. */
  remove(path: string, options?: OpOptions): Promise<void>;
  /** `node <path> [args]`, cwd `/workspace`. */
  exec(path: string, options?: ExecOptions): Promise<ExecResult>;
  /** The files as ADR-0567 bytes; `createSandbox({ snapshot })` restores them. */
  snapshot(options?: OpOptions): Promise<Uint8Array>;
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

/** Node's `AbortError` of a cancelled async API (`fs.promises.readFile(p, { signal })`). */
class AbortError extends Error {
  readonly code: string;
  constructor(cause: unknown) {
    super('The operation was aborted', { cause });
    this.code = 'ABORT_ERR';
    this.name = 'AbortError';
  }
}

/** The rejection of an aborted op; a `reason` getter that throws (a consumer bug) gives its error, as in Node. */
function abortError(signal: AbortSignal): unknown {
  try {
    return bare(new AbortError(signal.reason));
  } catch (error) {
    return bare(error);
  }
}

/**
 * `listener` on `signal`'s abort as Node's own APIs subscribe (`events.addAbortListener`):
 * Node's check of the signal, and no other listener's `stopImmediatePropagation()` skips it;
 * already aborted, it runs in a microtask.
 */
function onAbort(signal: AbortSignal, listener: () => void): Disposable {
  try {
    return addAbortListener(signal, listener);
  } catch (error) {
    const { code } = error as { code?: unknown };
    if (code !== 'ERR_INVALID_ARG_TYPE' || !(error instanceof Error)) throw error;
    // Its refusal names its own argument; here it is an option, in Node's fs wording.
    throw coded(
      new TypeError(
        error.message.replace('The "signal" argument', 'The "options.signal" property'),
      ),
      'ERR_INVALID_ARG_TYPE',
    );
  }
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
  'signal',
]);
const OP_OPTIONS = new Set(['signal']);

function knownOptions(options: object, known: Set<string>, where: string): void {
  for (const name of Object.keys(options)) {
    if (!known.has(name))
      throw coded(
        new TypeError(`The option '${name}' is not an option of ${where}`),
        'ERR_INVALID_ARG_VALUE',
      );
  }
}

/** A host op's options, read at the call. */
function opSignal(options: unknown, where: string): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (options === null || typeof options !== 'object')
    throw coded(
      new TypeError('The "options" argument must be of type object'),
      'ERR_INVALID_ARG_TYPE',
    );
  knownOptions(options, OP_OPTIONS, where);
  // Checked as it is subscribed (`onAbort`).
  return (options as OpOptions).signal;
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

/** A run's value and the state it leaves: applied only in the microtask that hands the caller the value. */
class Commit<T> {
  constructor(
    readonly value: T,
    readonly apply: () => void,
  ) {}
}

class LiveSandbox implements Sandbox {
  /**
   * The state, boxed: `destroy` drops the box, so a run that finishes after it
   * writes into a box nothing references any more — no state comes back.
   */
  #box: { fs: Fs } | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #run: CallHandle | undefined;
  /** Every call this sandbox placed, from its start until it has left (result out, isolate gone). */
  readonly #leaving = new Set<Promise<void>>();
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

  /**
   * One operation, after every earlier one (ADR-0568 §4). The queue keeps no result.
   * `signal` aborted before the op starts: it rejects `AbortError` at the abort and never
   * takes effect. `run`: also once started, until its caller has the result — the run in
   * flight is cancelled as by `destroy()`, and a `Commit` it returned is never applied.
   * Each op settles once; once `destroy()` is called, DESTROYED wins (ADR-0568 §5).
   */
  #op<T>(
    fn: (box: { fs: Fs }) => T | Commit<T> | Promise<T | Commit<T>>,
    signal?: AbortSignal,
    run = false,
  ): Promise<T> {
    let resolve: (value: T) => void = settle;
    let reject: (error: unknown) => void = settle;
    const caller = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    let done = false;
    let started = false;
    const abort = (): void => {
      if (done || this.#destroyed || (started && !run)) return;
      done = true;
      const error = abortError(signal as AbortSignal);
      reject(error);
      if (started) this.#run?.abort(error instanceof Error ? error : new AbortError(error));
    };
    let subscription: Disposable | undefined;
    try {
      if (signal !== undefined) subscription = onAbort(signal, abort);
    } catch (error) {
      // Not a signal, or its own member threw (a consumer bug): refused, nothing placed.
      return this.#refused(error);
    }
    const next = this.#tail
      .then(() => {
        if (this.#box === undefined || this.#destroyed) throw destroyedError();
        if (done) return undefined;
        started = true;
        return fn(this.#box);
      })
      // The last link, in the microtask that settles the caller's promise: an op still
      // in flight when destroy() was called rejects, whatever it had done (ADR-0568 §5).
      .then(
        (value) => {
          if (done) return;
          done = true;
          if (this.#destroyed) reject(bare(destroyedError()));
          else if (value instanceof Commit) {
            value.apply();
            resolve(value.value as T);
          } else resolve(value as T);
          subscription?.[Symbol.dispose]();
        },
        (error: unknown) => {
          if (done) return;
          done = true;
          reject(bare(this.#destroyed ? destroyedError() : error));
          subscription?.[Symbol.dispose]();
        },
      );
    this.#tail = next.then(settle, settle);
    return caller;
  }

  /** An op whose input failed validation at the call: it rejects in its turn. */
  #refused(error: unknown): Promise<never> {
    return this.#op(() => {
      throw error;
    });
  }

  writeFile(path: string, data: Uint8Array | string, options?: OpOptions): Promise<void> {
    let bytes: Uint8Array;
    let signal: AbortSignal | undefined;
    try {
      // The bytes at the call, not when the op reaches its turn.
      bytes = inputBytes(data, this.#maxFileBytes);
      signal = opSignal(options, 'writeFile');
    } catch (error) {
      return this.#refused(error);
    }
    return this.#op(({ fs }) => {
      const target = opPath(path, 'open');
      const parent = target.slice(0, target.lastIndexOf('/')) || '/';
      // A refused write leaves the state as it was, times included: those of the target and
      // of every existing directory above it, taken before anything reads or writes.
      const kept = existingChain(fs, target).map((p) => [p, timesOf(fs, p)] as const);
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
        for (const [p, times] of kept) fs.restoreStatSync(p, times);
        if (isCodec(error) && error.code === REFUSED[2])
          throw coded(
            new RangeError(
              `isolate-host sandbox: the sandbox is over maxFsBytes (${this.#options.maxBytes})`,
            ),
            'ERR_ISOLATE_HOST_SANDBOX_FULL',
          );
        throw error;
      }
    }, signal);
  }

  readFile(path: string, options?: OpOptions): Promise<Uint8Array> {
    let signal: AbortSignal | undefined;
    try {
      signal = opSignal(options, 'readFile');
    } catch (error) {
      return this.#refused(error);
    }
    return this.#op(({ fs }) => {
      const target = opPath(path, 'open');
      const stat = vfs('open', target, () => fs.statSync(target));
      if (stat.isDirectory) throw fsError('EISDIR', 'read', target);
      if ((stat.size ?? 0) > this.#maxFileBytes) throw tooLarge(stat.size ?? 0, this.#maxFileBytes);
      return copyOf(vfs('open', target, () => fs.readFileBytesSync(target)));
    }, signal);
  }

  list(path: string = WORKSPACE, options?: OpOptions): Promise<SandboxEntry[]> {
    let signal: AbortSignal | undefined;
    try {
      signal = opSignal(options, 'list');
    } catch (error) {
      return this.#refused(error);
    }
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
    }, signal);
  }

  remove(path: string, options?: OpOptions): Promise<void> {
    let signal: AbortSignal | undefined;
    try {
      signal = opSignal(options, 'remove');
    } catch (error) {
      return this.#refused(error);
    }
    return this.#op(({ fs }) => {
      const target = opPath(path, 'rm');
      if (!fs.existsSync(target)) throw fsError('ENOENT', 'rm', target);
      vfs('rm', target, () => fs.rmSync(target, { recursive: true }));
    }, signal);
  }

  exec(path: string, options: ExecOptions = {}): Promise<ExecResult> {
    // Everything the call passes is read and checked at the call (ADR-0568 §1); a refusal
    // rejects in the op's turn.
    let entry: string;
    let args: string[];
    let limits: ReturnType<typeof runLimits>;
    let signal: AbortSignal | undefined;
    try {
      knownOptions(options, EXEC_OPTIONS, 'exec');
      for (const option of ['env', 'cwd', 'stdin'] as const) {
        if (option in options)
          throw notImplemented(
            `isolate-host.sandbox-exec-${option}`,
            'a sandbox run is `node <path> [args]` in /workspace, ADR-0568',
          );
      }
      entry = sandboxPath(path);
      const given = options.args === undefined ? [] : options.args;
      if (!Array.isArray(given) || given.some((a) => typeof a !== 'string'))
        throw coded(
          new TypeError('The "options.args" property must be an array of strings'),
          'ERR_INVALID_ARG_TYPE',
        );
      args = [...given];
      limits = runLimits(options);
      signal = options.signal;
    } catch (error) {
      return this.#refused(error);
    }
    return this.#op(
      async (box) => {
        // Encoded per attempt (a rerun encodes the same files again): the call keeps no copy.
        const fs = box.fs;
        const state = (): Uint8Array => this.#codec.snapshotFs(fs, this.#options);
        const result = await sharedPool()
          .run(
            {
              code: '',
              ...limits,
              sandbox: { path: entry, args, state, maxFsBytes: this.#options.maxBytes },
            },
            (h) => {
              this.#run = h;
              // Registered with the call itself and removed only by its own "left" event:
              // destroy() waits for it in every phase of this exec (ADR-0568 §5).
              const gone = h.left();
              this.#leaving.add(gone);
              void gone.then(() => this.#leaving.delete(gone));
            },
          )
          .finally(() => {
            // Whatever the end — a destroy in flight too: no stale hold on the call (and its state).
            this.#run = undefined;
          });
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
        // Kept only if the caller gets this result (an abort before that rolls it back).
        return new Commit<ExecResult>(run, () => {
          box.fs = next;
        });
      },
      signal,
      true,
    );
  }

  snapshot(options?: OpOptions): Promise<Uint8Array> {
    let signal: AbortSignal | undefined;
    try {
      signal = opSignal(options, 'snapshot');
    } catch (error) {
      return this.#refused(error);
    }
    return this.#op(({ fs }) => copyOf(this.#codec.snapshotFs(fs, this.#options)), signal);
  }

  destroy(): Promise<void> {
    if (!this.#destroyed) {
      this.#destroyed = true;
      // The run in flight is cancelled.
      this.#run?.abort(destroyedError());
      this.#box = undefined;
    }
    // Every call this sandbox placed has left: the cancelled one and any still stopping.
    return this.#tail.then(() => Promise.all(this.#leaving)).then(settle);
  }
}

function tooLarge(size: number, max: number): Error {
  return coded(
    new RangeError(`File size (${size}) is greater than maxFileBytes (${max})`),
    'ERR_FS_FILE_TOO_LARGE',
  );
}

/** `/`, each existing directory down to `path`, and `path` itself when it exists. */
function existingChain(fs: Fs, path: string): string[] {
  const chain = ['/'];
  const parts = path.split('/').filter(Boolean);
  for (let n = 1; n <= parts.length; n++) {
    const p = `/${parts.slice(0, n).join('/')}`;
    if (!fs.existsSync(p)) break;
    chain.push(p);
  }
  return chain;
}

/** The four times of an entry, as the snapshot keeps them (ADR-0567). */
function timesOf(fs: Fs, path: string): EntryTimes {
  const { mtime, atime, metadata } = fs.statSync(path);
  if (mtime === undefined || atime === undefined || metadata === undefined)
    throw new TypeError('isolate-host sandbox: the FS does not report entry times');
  return {
    mtimeMs: mtime,
    atimeMs: atime,
    ctimeMs: metadata.ctime,
    birthtimeMs: metadata.birthtime,
  };
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
  let limits: { maxFsBytes: number; maxFileBytes: number };
  try {
    knownOptions(options, SANDBOX_OPTIONS, 'createSandbox');
    if ('template' in options)
      throw notImplemented(
        'isolate-host.sandbox-template',
        'a sandbox starts empty or from its own snapshot, ADR-0568',
      );
    const maxFsBytes = Math.floor(limit('maxFsBytes', options.maxFsBytes, 64 << 20, 0));
    const maxFileBytes = Math.floor(limit('maxFileBytes', options.maxFileBytes, 32 << 20, 0));
    limits = { maxFsBytes, maxFileBytes };
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
  return open(limits, snapshot).catch((error: unknown) => {
    throw bare(error);
  });
}

/** The codec's budget for an empty sandbox (`GUEST_DIRS`): no cap may be lower. */
let emptyCost: number | undefined;
function emptySandboxCost(c: Codec): number {
  if (emptyCost !== undefined) return emptyCost;
  const fs = new c.MemoryFsSync();
  for (const dir of c.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  const fits = (maxBytes: number): boolean => {
    try {
      c.snapshotFs(fs, { template: null, maxBytes });
      return true;
    } catch {
      return false;
    }
  };
  let lo = 0; // does not fit
  let hi = 1 << 20; // fits
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  emptyCost = hi;
  return hi;
}

async function open(
  { maxFsBytes, maxFileBytes }: { maxFsBytes: number; maxFileBytes: number },
  snapshot: Uint8Array | undefined,
): Promise<Sandbox> {
  const c = await loadCodec();
  const least = emptySandboxCost(c);
  if (maxFsBytes < least)
    throw coded(
      new RangeError(
        `The "options.maxFsBytes" must be at least ${least} (the budget of an empty sandbox). Received ${maxFsBytes}`,
      ),
      'ERR_OUT_OF_RANGE',
    );
  const fs = new c.MemoryFsSync();
  if (snapshot !== undefined) c.restoreFs(fs, snapshot, { template: null, maxBytes: maxFsBytes });
  else for (const dir of c.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  return new LiveSandbox(c, fs, maxFileBytes, maxFsBytes);
}
