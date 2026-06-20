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
    expect(() => new WASI({ version: 'unstable' })).not.toThrow();
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
});
