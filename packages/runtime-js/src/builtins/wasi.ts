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
 *   - `options.version` validation (ERR_INVALID_ARG_TYPE / ERR_INVALID_ARG_VALUE).
 *   - single-entry guard: `start()`/`initialize()` may run once (a second call
 *     throws `ERR_WASI_ALREADY_STARTED`).
 *   - both require an exported `WebAssembly.Memory` (ERR_INVALID_ARG_TYPE),
 *     matching Node (the runner would otherwise defer to a lazy "memory not set").
 */
export class WASI extends Wasi {
  #started = false;

  constructor(options?: NodeWasiOptions) {
    if (options === undefined || options === null || typeof options.version !== 'string') {
      throw invalidArgType('options.version', options?.version);
    }
    if (options.version !== 'preview1' && options.version !== 'unstable') {
      throw invalidArgValue(options.version);
    }
    super(options);
  }

  override start(instance: WebAssembly.Instance): number {
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
