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
import {
  type WorkerOutputState,
  createWorkerOutputState,
  workerOutputAttestation,
} from '../src/worker-stdio-drain.ts';

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
      outputState: createWorkerOutputState(),
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
  outputState: WorkerOutputState,
  expectedOrderFrames: readonly unknown[] = [
    {
      kind: 'control:stdio-order',
      stream: 'stderr',
      order: 0,
      attestation: workerOutputAttestation(outputState),
    },
  ],
): void {
  expect(target.postMessage).toHaveBeenCalledWith({
    type: 'exit',
    code: 1,
    attestation: workerOutputAttestation(outputState),
  });
  expect(ports[3]?.postMessage.mock.calls.map(([frame]) => frame)).toStrictEqual(
    expectedOrderFrames,
  );
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

    expectReaped(target, ports, spec.outputState);
  });

  it('publishes only the exact public process spec before guest entry', async () => {
    const target = new DispatchableWorkerTarget();
    const { spec, ports } = makeSpec();
    let published: unknown;
    setKernelPreEntryHook(() => {
      published = Reflect.get(globalThis, KERNEL_PROCESS_SPEC_KEY);
      const publishedStdio = (
        published as {
          readonly stdio?: {
            readonly stdout?: { write(bytes: Uint8Array): void };
            readonly stderr?: { write(bytes: Uint8Array): void };
          };
        }
      ).stdio;
      publishedStdio?.stdout?.write(new TextEncoder().encode('public-out'));
      publishedStdio?.stderr?.write(new TextEncoder().encode('public-err'));
      throw new Error('stop after process-spec inspection');
    });
    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

    await target.init(spec);

    if (typeof published !== 'object' || published === null) {
      throw new Error('Expected production worker entry to publish a process spec');
    }
    const record = published as Record<PropertyKey, unknown>;
    expect(Reflect.ownKeys(record).sort()).toEqual(['argv', 'cwd', 'env', 'pid', 'ppid', 'stdio']);
    expect(Object.values(record).some((value) => value instanceof SharedArrayBuffer)).toBe(false);
    expect(Object.hasOwn(record, 'outputState')).toBe(false);
    const stdio = record.stdio;
    if (typeof stdio !== 'object' || stdio === null) {
      throw new Error('Expected the public process spec to carry stdio');
    }
    expect(Reflect.ownKeys(stdio).sort()).toEqual(['ipc', 'stderr', 'stdin', 'stdout']);
    const attestation = workerOutputAttestation(spec.outputState);
    const exposesOutputCapability = (value: unknown, seen = new Set<object>()): boolean => {
      if (
        value === spec.outputState ||
        value === attestation ||
        value instanceof SharedArrayBuffer
      ) {
        return true;
      }
      if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function') ||
        seen.has(value)
      ) {
        return false;
      }
      seen.add(value);
      return Reflect.ownKeys(value).some((key) =>
        exposesOutputCapability(Reflect.get(value, key), seen),
      );
    };
    const stdioRecord = stdio as Record<PropertyKey, unknown>;
    for (const stream of ['stdout', 'stderr'] as const) {
      const writer = stdioRecord[stream];
      if (typeof writer !== 'object' || writer === null) {
        throw new Error(`Expected the public ${stream} writer capability`);
      }
      expect(Reflect.ownKeys(writer)).toEqual(['write']);
      expect(typeof Reflect.get(writer, 'write')).toBe('function');
      expect(exposesOutputCapability(writer)).toBe(false);
    }
    expect(
      ports[0]?.postMessage.mock.calls.map(([frame]) =>
        new TextDecoder().decode(frame as Uint8Array),
      ),
    ).toEqual(['public-out']);
    const stderrFrames = ports[1]?.postMessage.mock.calls.map(([frame]) =>
      new TextDecoder().decode(frame as Uint8Array),
    );
    expect(stderrFrames?.[0]).toBe('public-err');
    expect(stderrFrames?.[1]).toContain('stop after process-spec inspection');
    expectReaped(target, ports, spec.outputState, [
      {
        kind: 'control:stdio-order',
        stream: 'stdout',
        order: 0,
        attestation,
      },
      {
        kind: 'control:stdio-order',
        stream: 'stderr',
        order: 1,
        attestation,
      },
      {
        kind: 'control:stdio-order',
        stream: 'stderr',
        order: 2,
        attestation,
      },
    ]);
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

      expectReaped(target, ports, spec.outputState);
      const stderr = ports[1]?.postMessage.mock.calls[0]?.[0] as Uint8Array;
      expect(new TextDecoder().decode(stderr)).toContain(fault.message);
    },
  );
});
