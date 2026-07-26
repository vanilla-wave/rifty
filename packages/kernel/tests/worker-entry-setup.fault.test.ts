import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSabRing } from '../src/ipc/sab-ring.ts';
import {
  KERNEL_ENTRY_BOOTSTRAP_KEY,
  KERNEL_PROCESS_SPEC_KEY,
  KERNEL_SYNC_CALL_KEY,
} from '../src/shared-globals.ts';
import {
  type WorkerInitMessage,
  type WorkerSpawnSpec,
  installWorkerEntry,
  setKernelDrainHook,
  setKernelPreEntryHook,
} from '../src/worker-entry.ts';

const KERNEL_ENTRY_CAPABILITY_PORTS_KEY = '__riftyKernelEntryCapabilityPorts__';
const ORIGINAL_DEFINE_PROPERTY = Object.defineProperty;

function fakePort(): MessagePort & {
  readonly close: ReturnType<typeof vi.fn>;
  readonly postMessage: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    postMessage: vi.fn(),
  } as unknown as MessagePort & {
    readonly close: ReturnType<typeof vi.fn>;
    readonly postMessage: ReturnType<typeof vi.fn>;
  };
}

class DispatchableWorkerTarget {
  readonly postMessage = vi.fn();
  readonly nativeClose = vi.fn();
  close = this.nativeClose;
  private listener: EventListener | null = null;

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listener = listener;
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message' && this.listener === listener) this.listener = null;
  }

  async init(spec: WorkerSpawnSpec): Promise<void> {
    const listener = this.listener;
    if (listener === null) throw new Error('worker entry listener is not installed');
    const message: WorkerInitMessage = { type: 'init', spec };
    await listener(new MessageEvent('message', { data: message }));
  }
}

function makeSpec(invalidRing = false): {
  readonly spec: WorkerSpawnSpec;
  readonly ports: readonly ReturnType<typeof fakePort>[];
} {
  const capability = fakePort();
  Object.setPrototypeOf(capability, MessagePort.prototype);
  const ports = [fakePort(), fakePort(), fakePort(), fakePort(), capability] as const;
  const { sab } = createSabRing({ payloadCapacity: 32 });
  return {
    spec: {
      entry: {
        kind: 'url',
        url: 'https://example.invalid/entry.js',
        capabilityPorts: { test: ports[4] },
      },
      argv: [],
      env: {},
      cwd: '/',
      stdio: {
        stdout: ports[0],
        stderr: ports[1],
        stdin: ports[2],
        ipc: ports[3],
      },
      syncRing: invalidRing ? new SharedArrayBuffer(64) : sab,
      payloadCapacity: 32,
      pid: 2,
      ppid: 1,
    },
    ports,
  };
}

function expectReaped(
  target: DispatchableWorkerTarget,
  ports: readonly ReturnType<typeof fakePort>[],
): void {
  expect(target.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 1 });
  expect(ports[3]?.postMessage).toHaveBeenCalledWith({
    kind: 'control:exiting',
    code: 1,
  });
  expect(target.nativeClose).toHaveBeenCalledTimes(1);
  for (const port of ports) expect(port.close).toHaveBeenCalledTimes(1);
}

describe('worker-entry setup transaction', () => {
  beforeEach(() => {
    setKernelPreEntryHook(null);
    setKernelDrainHook(null);
    vi.stubGlobal('WorkerGlobalScope', class WorkerGlobalScope {});
    vi.stubGlobal('postMessage', vi.fn());
    Reflect.deleteProperty(globalThis, 'window');
  });

  afterEach(() => {
    setKernelPreEntryHook(null);
    setKernelDrainHook(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const key of [
      KERNEL_SYNC_CALL_KEY,
      KERNEL_PROCESS_SPEC_KEY,
      KERNEL_ENTRY_BOOTSTRAP_KEY,
      KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
    ]) {
      Reflect.deleteProperty(globalThis, key);
    }
  });

  it('finalizes every transferred port and the realm when SAB attach fails', async () => {
    const target = new DispatchableWorkerTarget();
    const { spec, ports } = makeSpec(true);
    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

    await target.init(spec);

    expectReaped(target, ports);
  });

  it.each([
    KERNEL_SYNC_CALL_KEY,
    KERNEL_PROCESS_SPEC_KEY,
    KERNEL_ENTRY_BOOTSTRAP_KEY,
    KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
  ])(
    'finalizes every transferred port and the realm when %s publication fails',
    async (faultKey) => {
      const target = new DispatchableWorkerTarget();
      const { spec, ports } = makeSpec();
      const fault = new Error(`${faultKey}-failed`);
      vi.spyOn(Object, 'defineProperty').mockImplementation((object, key, descriptor) => {
        if (object === globalThis && key === faultKey) throw fault;
        return ORIGINAL_DEFINE_PROPERTY(object, key, descriptor);
      });
      installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

      await target.init(spec);

      expectReaped(target, ports);
      const stderr = ports[1]?.postMessage.mock.calls[0]?.[0] as Uint8Array;
      expect(new TextDecoder().decode(stderr)).toContain(fault.message);
    },
  );
});
