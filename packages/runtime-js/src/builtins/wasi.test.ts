import { describe, expect, it } from 'vitest';
import { ensureRuntimeJsBuiltinsRegistered, loadBuiltin } from './index.ts';

describe('node:wasi builtin', () => {
  it('exports a WASI class backed by the runtime-wasi implementation', () => {
    ensureRuntimeJsBuiltinsRegistered();

    const wasiModule = loadBuiltin('node:wasi') as {
      WASI: new (options?: { version: string }) => unknown;
    };
    const { WASI } = wasiModule;
    expect(WASI).toBeTypeOf('function');

    const wasi = new WASI({ version: 'preview1' }) as {
      wasiImport?: WebAssembly.ModuleImports;
      getImportObject?: () => WebAssembly.Imports;
    };

    expect(wasi.wasiImport).toBeDefined();
    expect(wasi.getImportObject?.()).toEqual({
      wasi_snapshot_preview1: wasi.wasiImport,
    });
  });

  it('matches Node constructor validation for options.version', () => {
    ensureRuntimeJsBuiltinsRegistered();

    const { WASI } = loadBuiltin('node:wasi') as {
      WASI: new (options?: { version?: unknown }) => unknown;
    };

    expect(() => new WASI()).toThrow(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    expect(() => new WASI({})).toThrow(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    expect(() => new WASI({ version: 1 })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
    expect(() => new WASI({ version: 'preview2' })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' }),
    );
    // 'unstable' (snapshot0) is a Node-valid version rifty does not implement (the
    // runner only serves the preview1 namespace) — an honest loud gap, not a
    // silent flatten to preview1.
    expect(() => new WASI({ version: 'unstable' })).toThrow(
      expect.objectContaining({ name: 'NotImplementedError' }),
    );
  });
});

type WasiStartable = {
  start(instance: WebAssembly.Instance): number;
  initialize(instance: WebAssembly.Instance): void;
};

function loadWasiCtor(): new (options?: { version: string }) => WasiStartable {
  ensureRuntimeJsBuiltinsRegistered();
  return (loadBuiltin('node:wasi') as { WASI: new (o?: { version: string }) => WasiStartable })
    .WASI;
}

function instanceWith(exports: Record<string, unknown>): WebAssembly.Instance {
  return { exports } as unknown as WebAssembly.Instance;
}

describe('node:wasi WASI single-entry + memory guards (Node parity)', () => {
  it('start() throws ERR_WASI_ALREADY_STARTED on a second call', () => {
    const WASI = loadWasiCtor();
    const wasi = new WASI({ version: 'preview1' });
    const instance = instanceWith({
      memory: new WebAssembly.Memory({ initial: 1 }),
      _start: () => {},
    });
    wasi.start(instance);
    // Code + message verified verbatim against Node v24 `node:wasi`.
    expect(() => wasi.start(instance)).toThrow(
      expect.objectContaining({
        code: 'ERR_WASI_ALREADY_STARTED',
        message: 'WASI instance has already started',
      }),
    );
  });

  it('initialize() then a second start()/initialize() throws ERR_WASI_ALREADY_STARTED', () => {
    const WASI = loadWasiCtor();
    const wasi = new WASI({ version: 'preview1' });
    const reactor = instanceWith({
      memory: new WebAssembly.Memory({ initial: 1 }),
      _initialize: () => {},
    });
    wasi.initialize(reactor);
    expect(() => wasi.initialize(reactor)).toThrow(
      expect.objectContaining({ code: 'ERR_WASI_ALREADY_STARTED' }),
    );
  });

  it('start()/initialize() require an exported WebAssembly.Memory (ERR_INVALID_ARG_TYPE)', () => {
    const WASI = loadWasiCtor();
    // Code + message verified verbatim against Node v24 `node:wasi`.
    const expected = expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      message: '"instance.exports.memory" property must be a WebAssembly.Memory object',
    });
    expect(() =>
      new WASI({ version: 'preview1' }).start(instanceWith({ _start: () => {} })),
    ).toThrow(expected);
    expect(() =>
      new WASI({ version: 'preview1' }).initialize(instanceWith({ _initialize: () => {} })),
    ).toThrow(expected);
  });

  it('a memory-validation failure does NOT latch — retryable (Node: kSetMemory runs before kStarted)', () => {
    // Verified vs Node v24 lib/wasi.js: memory is validated before `started` is
    // latched, so a missing-memory start() is retryable (the retry surfaces the
    // same memory error, NOT ERR_WASI_ALREADY_STARTED).
    const WASI = loadWasiCtor();
    const wasi = new WASI({ version: 'preview1' });
    const noMemory = instanceWith({ _start: () => {} });
    expect(() => wasi.start(noMemory)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
    expect(() => wasi.start(noMemory)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
  });

  it('start() latches BEFORE the _start shape check (Node finalizeBindings) — a missing-_start retry throws ERR_WASI_ALREADY_STARTED', () => {
    // Verified vs Node v24: kStarted is set inside finalizeBindings, before
    // validateFunction(_start). So a missing-_start failure is already latched and
    // the retry is ERR_WASI_ALREADY_STARTED (NOT the underlying _start error).
    const WASI = loadWasiCtor();
    const wasi = new WASI({ version: 'preview1' });
    const noStart = instanceWith({ memory: new WebAssembly.Memory({ initial: 1 }) });
    expect(() => wasi.start(noStart)).toThrow(/has no _start export/);
    expect(() => wasi.start(noStart)).toThrow(
      expect.objectContaining({ code: 'ERR_WASI_ALREADY_STARTED' }),
    );
  });

  it('initialize() latches BEFORE the module-shape check — a has-_start retry throws ERR_WASI_ALREADY_STARTED', () => {
    const WASI = loadWasiCtor();
    const wasi = new WASI({ version: 'preview1' });
    const command = instanceWith({
      memory: new WebAssembly.Memory({ initial: 1 }),
      _start: () => {},
    });
    expect(() => wasi.initialize(command)).toThrow(/without _start export/);
    expect(() => wasi.initialize(command)).toThrow(
      expect.objectContaining({ code: 'ERR_WASI_ALREADY_STARTED' }),
    );
  });
});
