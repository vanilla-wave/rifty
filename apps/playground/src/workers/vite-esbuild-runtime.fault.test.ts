import { readRuntimeEsbuild } from '@riftydev/runtime-js';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const packageRoot = '/workspace/node_modules/vite';

function exactViteFs(): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    `${packageRoot}/package.json`,
    new TextEncoder().encode('{"name":"vite","version":"7.3.6"}'),
  );
  return fs;
}

async function prepare(esbuildWasmUrl = 'blob:inherited-esbuild-wasm'): Promise<void> {
  vi.resetModules();
  const runtime = await import('./vite-esbuild-runtime.ts');
  await runtime.prepareViteEsbuildRuntime({
    fs: exactViteFs(),
    cwd: '/workspace',
    packageRoot,
    esbuildWasmUrl,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe('Vite esbuild asset acquisition fault matrix', () => {
  it('fetches only the esbuild URL inherited from the worker host config', async () => {
    const inheritedUrl = 'blob:exact-host-esbuild-wasm';
    let fetchedUrl: string | undefined;
    globalThis.fetch = async (input) => {
      fetchedUrl = String(input);
      throw new Error('stop after provenance capture');
    };

    await expect(prepare(inheritedUrl)).rejects.toThrow('stop after provenance capture');
    expect(fetchedUrl).toBe(inheritedUrl);
    expect(readRuntimeEsbuild()).toBeNull();
  });

  it('header stall fails startup and publishes no runtime', async () => {
    vi.useFakeTimers();
    let fetched!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    globalThis.fetch = () => {
      fetched();
      return new Promise<Response>(() => {});
    };
    const startup = prepare();
    startup.catch(() => {});
    await fetchStarted;
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(startup).rejects.toThrow('esbuild-wasm asset: no response headers');
    expect(readRuntimeEsbuild()).toBeNull();
  });

  it('body stall fails startup and publishes no runtime', async () => {
    vi.useFakeTimers();
    let fetched!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    globalThis.fetch = async () => {
      fetched();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0]));
          },
        }),
      );
    };
    const startup = prepare();
    startup.catch(() => {});
    await fetchStarted;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(startup).rejects.toThrow('esbuild-wasm asset: no body progress');
    expect(readRuntimeEsbuild()).toBeNull();
  });

  it('declared oversize fails before compilation and publishes no runtime', async () => {
    globalThis.fetch = async () =>
      new Response(null, { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } });
    await expect(prepare()).rejects.toThrow('esbuild-wasm asset: body exceeded 16777216 bytes');
    expect(readRuntimeEsbuild()).toBeNull();
  });
});
