import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface VariantOptions {
  readonly wasmLocation?: string;
  readonly wasmBinary?: ArrayBuffer | (() => Promise<ArrayBuffer>);
}

const h = vi.hoisted(() => ({
  baseVariant: Object.freeze({ id: 'base-variant' }),
  locatedVariant: Object.freeze({ id: 'located-variant' }),
  loadedModule: Object.freeze({ id: 'quickjs-module' }),
  loadedVariant: undefined as unknown,
  loadedWasmBytes: undefined as ArrayBuffer | undefined,
  variantOptions: undefined as VariantOptions | undefined,
  upstreamFailure: undefined as Error | undefined,
  location: undefined as string | undefined,
  loadAttempts: 0,
  failuresRemaining: 0,
}));

vi.mock('@jitl/quickjs-wasmfile-release-sync', () => ({ default: h.baseVariant }));
vi.mock('quickjs-emscripten-core', () => ({
  newVariant: (base: unknown, options: VariantOptions) => {
    expect(base).toBe(h.baseVariant);
    h.variantOptions = options;
    h.location = options.wasmLocation;
    return h.locatedVariant;
  },
  newQuickJSWASMModuleFromVariant: async (loadedVariant: unknown) => {
    h.loadedVariant = loadedVariant;
    h.loadAttempts += 1;
    const wasmBinary = h.variantOptions?.wasmBinary;
    if (loadedVariant === h.locatedVariant && wasmBinary !== undefined) {
      h.loadedWasmBytes = typeof wasmBinary === 'function' ? await wasmBinary() : wasmBinary;
      if (h.upstreamFailure !== undefined) throw h.upstreamFailure;
    }
    if (h.failuresRemaining > 0) {
      h.failuresRemaining -= 1;
      throw new Error('transient quickjs asset failure');
    }
    return h.loadedModule;
  },
}));

const quickjsGlobal = '__RIFTY_QUICKJS_WASM_URL';
const runtimeRoot = '__rifty';
const savedEnv = process.env.RIFTY_QUICKJS_WASM_URL;
const nativeProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
const nativeWorkerGlobalScopeDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'WorkerGlobalScope',
);

beforeEach(() => {
  vi.resetModules();
  Reflect.deleteProperty(globalThis, runtimeRoot);
  (globalThis as Record<string, unknown>)[quickjsGlobal] = undefined;
  Reflect.deleteProperty(process.env, 'RIFTY_QUICKJS_WASM_URL');
  h.loadedVariant = undefined;
  h.loadedWasmBytes = undefined;
  h.variantOptions = undefined;
  h.upstreamFailure = undefined;
  h.location = undefined;
  h.loadAttempts = 0;
  h.failuresRemaining = 0;
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, runtimeRoot);
  (globalThis as Record<string, unknown>)[quickjsGlobal] = undefined;
  Reflect.deleteProperty(globalThis, 'WorkerGlobalScope');
  if (nativeWorkerGlobalScopeDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'WorkerGlobalScope', nativeWorkerGlobalScopeDescriptor);
  }
  if (nativeProcessDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'process', nativeProcessDescriptor);
  }
  if (savedEnv === undefined) Reflect.deleteProperty(process.env, 'RIFTY_QUICKJS_WASM_URL');
  else process.env.RIFTY_QUICKJS_WASM_URL = savedEnv;
  vi.unstubAllGlobals();
});

describe('QuickJS browser preload asset authority', () => {
  it('threads the host-published URL and owner-fetched bytes into the upstream variant', async () => {
    const wasmLocation = 'https://host.example/assets/quickjs.wasm';
    const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    (globalThis as Record<string, unknown>)[quickjsGlobal] = wasmLocation;
    Object.defineProperty(globalThis, 'WorkerGlobalScope', {
      value: class WorkerGlobalScope {},
      configurable: true,
    });
    const loader = await import('./quickjs-loader.ts');
    const response = new Response(wasmBytes, { status: 200, statusText: 'OK' });
    const targetFetch = vi.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> => response,
    );
    vi.stubGlobal('fetch', targetFetch);

    await loader.ensureVmEngineReady();

    expect(h.variantOptions).toMatchObject({
      wasmLocation,
      wasmBinary: expect.any(Function),
    });
    expect(targetFetch).toHaveBeenCalledOnce();
    expect(targetFetch).toHaveBeenCalledWith(wasmLocation);
    expect(response.bodyUsed).toBe(true);
    expect(h.loadedWasmBytes).toBeDefined();
    expect(Array.from(new Uint8Array(h.loadedWasmBytes ?? new ArrayBuffer(0)))).toEqual(
      Array.from(wasmBytes),
    );
    expect(h.loadedVariant).toBe(h.locatedVariant);
  });

  it('cancels an HTTP failure body before rejecting exactly', async () => {
    const wasmLocation = 'https://host.example/assets/missing-quickjs.wasm';
    (globalThis as Record<string, unknown>)[quickjsGlobal] = wasmLocation;
    Object.defineProperty(globalThis, 'WorkerGlobalScope', {
      value: class WorkerGlobalScope {},
      configurable: true,
    });
    const loader = await import('./quickjs-loader.ts');
    const response = new Response('not found', { status: 404, statusText: 'Not Found' });
    const responseBody = response.body;
    if (responseBody === null) throw new Error('HTTP fault fixture requires a response body');
    const cancelBody = vi.spyOn(responseBody, 'cancel');
    const targetFetch = vi.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> => response,
    );
    vi.stubGlobal('fetch', targetFetch);

    await expect(loader.ensureVmEngineReady()).rejects.toThrowError(
      /^runtime-js\/quickjs-loader: fetch\(https:\/\/host\.example\/assets\/missing-quickjs\.wasm\) → 404 Not Found$/,
    );

    expect(targetFetch).toHaveBeenCalledOnce();
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(true);
    expect(h.loadedWasmBytes).toBeUndefined();
  });

  it('keeps the HTTP failure primary when body cancellation rejects and can retry', async () => {
    const wasmLocation = 'https://host.example/assets/cancel-fault-quickjs.wasm';
    const cancelFailure = new Error('response body cancel failed');
    let cancelCalls = 0;
    const failedResponse = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalls += 1;
          return Promise.reject(cancelFailure);
        },
      }),
      { status: 404, statusText: 'Not Found' },
    );
    const retryBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const responses = [failedResponse, new Response(retryBytes, { status: 200, statusText: 'OK' })];
    (globalThis as Record<string, unknown>)[quickjsGlobal] = wasmLocation;
    Object.defineProperty(globalThis, 'WorkerGlobalScope', {
      value: class WorkerGlobalScope {},
      configurable: true,
    });
    const loader = await import('./quickjs-loader.ts');
    const targetFetch = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => {
      const response = responses.shift();
      if (response === undefined) throw new Error('unexpected extra QuickJS fetch');
      return response;
    });
    vi.stubGlobal('fetch', targetFetch);

    await expect(loader.ensureVmEngineReady()).rejects.toThrowError(
      /^runtime-js\/quickjs-loader: fetch\(https:\/\/host\.example\/assets\/cancel-fault-quickjs\.wasm\) → 404 Not Found$/,
    );

    expect(cancelCalls).toBe(1);
    expect(failedResponse.bodyUsed).toBe(true);
    await expect(loader.ensureVmEngineReady()).resolves.toBe(h.loadedModule);
    expect(targetFetch).toHaveBeenCalledTimes(2);
    expect(Array.from(new Uint8Array(h.loadedWasmBytes ?? new ArrayBuffer(0)))).toEqual(
      Array.from(retryBytes),
    );
  });

  it('preserves the upstream CompileError identity for corrupt owner-fetched bytes', async () => {
    const wasmLocation = 'https://host.example/assets/corrupt-quickjs.wasm';
    const corruptBytes = new Uint8Array([0, 97, 115, 109, 255]);
    const compileError = new WebAssembly.CompileError('upstream rejected corrupt QuickJS WASM');
    h.upstreamFailure = compileError;
    (globalThis as Record<string, unknown>)[quickjsGlobal] = wasmLocation;
    Object.defineProperty(globalThis, 'WorkerGlobalScope', {
      value: class WorkerGlobalScope {},
      configurable: true,
    });
    const loader = await import('./quickjs-loader.ts');
    const response = new Response(corruptBytes, { status: 200, statusText: 'OK' });
    const targetFetch = vi.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> => response,
    );
    vi.stubGlobal('fetch', targetFetch);

    await expect(loader.ensureVmEngineReady()).rejects.toBe(compileError);

    expect(response.bodyUsed).toBe(true);
    expect(h.loadedWasmBytes).toBeDefined();
    expect(Array.from(new Uint8Array(h.loadedWasmBytes ?? new ArrayBuffer(0)))).toEqual(
      Array.from(corruptBytes),
    );
    expect(h.loadedVariant).toBe(h.locatedVariant);
  });

  it('keeps an explicit native Node wasmLocation without owner-fetching it', async () => {
    const wasmLocation = 'https://node-harness.example/assets/quickjs.wasm';
    (globalThis as Record<string, unknown>)[quickjsGlobal] = wasmLocation;
    const loader = await import('./quickjs-loader.ts');
    const targetFetch = vi.fn(async (): Promise<Response> => {
      throw new Error('native Node must not owner-fetch QuickJS WASM');
    });
    vi.stubGlobal('fetch', targetFetch);

    await loader.ensureVmEngineReady();

    expect(h.variantOptions).toEqual({ wasmLocation });
    expect(h.loadedVariant).toBe(h.locatedVariant);
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it('keeps Node artifact resolution after guest worker globals replace the host process', async () => {
    const loader = await import('./quickjs-loader.ts');
    const targetFetch = vi.fn(async (): Promise<Response> => {
      throw new Error('native Node must not fetch QuickJS WASM');
    });
    vi.stubGlobal('fetch', targetFetch);
    Object.defineProperties(globalThis, {
      process: {
        value: { env: {}, versions: { node: '24.0.0', rifty: '0.0.0' } },
        configurable: true,
      },
      WorkerGlobalScope: {
        value: class WorkerGlobalScope {},
        configurable: true,
      },
    });

    await loader.ensureVmEngineReady();

    expect(h.location).toBeUndefined();
    expect(h.variantOptions).toBeUndefined();
    expect(h.loadedVariant).toBe(h.baseVariant);
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it('shares one ready module across duplicated runtime-js module copies in one realm', async () => {
    const firstLoader = await import('./quickjs-loader.ts');
    const firstModule = await firstLoader.ensureVmEngineReady();

    vi.resetModules();
    const secondLoader = await import('./quickjs-loader.ts');

    expect(secondLoader.isVmEngineReady()).toBe(true);
    expect(secondLoader.getQuickJsModuleSync()).toBe(firstModule);
    await expect(secondLoader.ensureVmEngineReady()).resolves.toBe(firstModule);
    expect(h.loadAttempts).toBe(1);
  });

  it('clears a rejected preload so the same realm can retry', async () => {
    h.failuresRemaining = 1;
    const loader = await import('./quickjs-loader.ts');

    await expect(loader.ensureVmEngineReady()).rejects.toThrow('transient quickjs asset failure');
    await expect(loader.ensureVmEngineReady()).resolves.toBe(h.loadedModule);
    expect(h.loadAttempts).toBe(2);
  });
});
