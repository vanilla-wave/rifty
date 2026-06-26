import { NotImplementedError } from '@riftydev/io';
import { Wasi, type WasiOptions } from '@riftydev/runtime-wasi';

type NodeWasiOptions = WasiOptions & { version: string };

function invalidArgType(name: string, received: unknown): TypeError {
  const type = received === undefined ? 'undefined' : typeof received;
  return Object.assign(
    new TypeError(`The "${name}" property must be of type string. Received ${type}`),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function invalidArgValue(version: string): TypeError {
  return Object.assign(
    new TypeError(`The property 'options.version' unsupported WASI version. Received '${version}'`),
    { code: 'ERR_INVALID_ARG_VALUE' },
  );
}

function alreadyStarted(): Error {
  return Object.assign(new Error('WASI instance has already started'), {
    code: 'ERR_WASI_ALREADY_STARTED',
  });
}

function requireExportedMemory(instance: WebAssembly.Instance): void {
  const memory = (instance as { exports?: Record<string, unknown> }).exports?.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    // Message verified verbatim against Node v24 `node:wasi`.
    throw Object.assign(
      new TypeError('"instance.exports.memory" property must be a WebAssembly.Memory object'),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
}

/**
 * Node-facing `node:wasi.WASI` over rifty's lower-level {@link Wasi} runner.
 * Adds the Node contract the runner deliberately omits (it stays a lenient
 * internal preview1 runner used by `runWasi`/`runWasiInWorker`):
 *   - `options.version` validation (ERR_INVALID_ARG_TYPE / ERR_INVALID_ARG_VALUE);
 *     `'unstable'` (snapshot0) is a loud `NotImplementedError` — the runner only
 *     serves the `wasi_snapshot_preview1` namespace, so accepting `'unstable'`
 *     would silently mis-link the guest (different namespace + syscall ABI).
 *   - single-entry guard: `start()`/`initialize()` may run once (a second call
 *     throws `ERR_WASI_ALREADY_STARTED`). Node latches `started` after memory
 *     validation but BEFORE the `_start` shape check (lib/wasi.js
 *     `finalizeBindings`, verified vs Node v24), so a memory failure is retryable
 *     while a missing-`_start` failure latches (its retry throws ALREADY_STARTED).
 *   - both require an exported `WebAssembly.Memory` (ERR_INVALID_ARG_TYPE),
 *     matching Node (the runner would otherwise defer to a lazy "memory not set").
 */
export class WASI extends Wasi {
  #started = false;

  constructor(options?: NodeWasiOptions) {
    if (options === undefined || options === null || typeof options.version !== 'string') {
      throw invalidArgType('options.version', options?.version);
    }
    if (options.version === 'unstable') {
      // Node accepts 'unstable' (snapshot0), but rifty's runner only builds the
      // `wasi_snapshot_preview1` namespace and preview1 syscall ABI. Accepting it
      // would silently mis-link the guest; honest loud gap instead of a flatten.
      // TODO(backlog: runtime-wasi/wasi-unstable-version-support)
      throw new NotImplementedError(
        'wasi.WASI.version:unstable',
        'rifty implements WASI preview1 only',
      );
    }
    if (options.version !== 'preview1') {
      throw invalidArgValue(options.version);
    }
    super(options);
  }

  override start(instance: WebAssembly.Instance): number {
    // Node `finalizeBindings` order: validate memory (retryable) → latch `started`
    // → THEN the runner validates `_start`/runs. So a missing-`_start` failure is
    // already latched and a retry throws ERR_WASI_ALREADY_STARTED, matching Node.
    requireExportedMemory(instance);
    if (this.#started) throw alreadyStarted();
    this.#started = true;
    return super.start(instance);
  }

  override initialize(instance: WebAssembly.Instance): void {
    requireExportedMemory(instance);
    if (this.#started) throw alreadyStarted();
    this.#started = true;
    super.initialize(instance);
  }
}

const wasiModule = { WASI };

export default wasiModule;
