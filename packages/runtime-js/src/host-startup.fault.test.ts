import { afterEach, expect, it, vi } from 'vitest';
import { type RuntimeOptions, spawnToolchainRuntime } from './host.ts';
import { SANDBOX_TOOLCHAIN_PROTOCOL } from './protocol.ts';

// Native Worker/clock boundary; the runtime controller is real.
class Peer {
  static latest: Peer;
  terminated = false;
  private receive?: (event: MessageEvent) => void;
  constructor() {
    Peer.latest = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') this.receive = listener;
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.receive?.({ data } as MessageEvent);
  }
  ready() {
    this.emit({ type: 'ready' });
    this.emit({
      type: 'toolchain-ready',
      protocol: SANDBOX_TOOLCHAIN_PROTOCOL,
      vfsBackend: 'memory',
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function boot(startupTimeoutMs: number) {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', Peer);
  const options: RuntimeOptions & { startupTimeoutMs: number } = {
    workerUrl: '/worker.js',
    startupTimeoutMs,
  };
  return spawnToolchainRuntime(options);
}

it('a configured startup budget can exceed the former 10s deadline', async () => {
  const runtime = boot(20_000);
  const result = runtime.toolchainReady.then(
    () => 'ready',
    () => 'rejected',
  );
  await vi.advanceTimersByTimeAsync(15_000);
  Peer.latest.ready();
  expect(await result).toBe('ready');
  runtime.dispose();
});

it('the largest native timer budget stays pending past the old deadline', async () => {
  const runtime = boot(2_147_483_647);
  const result = runtime.toolchainReady.then(
    () => 'ready',
    () => 'rejected',
  );
  await vi.advanceTimersByTimeAsync(20_000);
  Peer.latest.ready();
  expect(await result).toBe('ready');
  runtime.dispose();
});

it('rejects a pre-configuration worker before accepting its storage', async () => {
  const runtime = boot(10_000);
  const peer = Peer.latest;
  const rejected = expect(runtime.toolchainReady).rejects.toThrow(/invalid readiness/);
  peer.emit({ type: 'ready' });
  peer.emit({
    type: 'toolchain-ready',
    protocol: 'rifty.sandbox-toolchain/v3',
    vfsBackend: 'opfs',
  });
  await rejected;
  expect(peer.terminated).toBe(true);
  runtime.dispose();
});

it('timeout terminates the worker and rejects every queued startup call without revival', async () => {
  const runtime = boot(50);
  const peer = Peer.latest;
  const settled = Promise.allSettled([
    runtime.toolchainReady,
    runtime.eval('1+1'),
    runtime.fs.readFile('/saved'),
  ]);
  await vi.advanceTimersByTimeAsync(50);
  expect(peer.terminated).toBe(true);
  expect((await settled).map((result) => result.status)).toEqual([
    'rejected',
    'rejected',
    'rejected',
  ]);
  peer.ready();
  expect(runtime.isReady()).toBe(false);
  runtime.dispose();
});

it.each(['dispose', 'close'] as const)(
  '%s settles pending boot and ignores late readiness',
  async (action) => {
    const runtime = boot(20_000);
    const peer = Peer.latest;
    const result = Promise.allSettled([runtime.toolchainReady, runtime.fs.readFile('/saved')]);
    if (action === 'dispose') runtime.dispose();
    else peer.emit({ type: 'toolchain-terminal', reason: 'closed' });
    expect((await result).map((item) => item.status)).toEqual(['rejected', 'rejected']);
    expect(peer.terminated).toBe(true);
    peer.ready();
    expect(runtime.isReady()).toBe(false);
    runtime.dispose();
  },
);
