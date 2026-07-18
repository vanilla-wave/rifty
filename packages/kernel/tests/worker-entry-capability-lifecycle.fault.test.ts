import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSabRing } from '../src/ipc/sab-ring.ts';
import {
  KERNEL_ENTRY_BOOTSTRAP_KEY,
  KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
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

const OriginalObjectDefineProperty = Object.defineProperty;

function fakePort(
  label: string,
  order: string[],
): MessagePort & {
  readonly close: ReturnType<typeof vi.fn>;
  readonly postMessage: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(() => order.push(`close:${label}`)),
    postMessage: vi.fn(() => order.push(`post:${label}`)),
  } as unknown as MessagePort & {
    readonly close: ReturnType<typeof vi.fn>;
    readonly postMessage: ReturnType<typeof vi.fn>;
  };
}

class DispatchableWorkerTarget {
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  private listener: EventListener | null = null;

  constructor(order: string[] = []) {
    this.postMessage = vi.fn(() => order.push('post:exit'));
    this.close = vi.fn(() => order.push('close:realm'));
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listener = listener;
    }
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

function makeSpec(
  capability: MessagePort,
  order: string[] = [],
): {
  readonly spec: WorkerSpawnSpec;
  readonly fixed: readonly ReturnType<typeof fakePort>[];
} {
  const stdout = fakePort('stdout', order);
  const stderr = fakePort('stderr', order);
  const stdin = fakePort('stdin', order);
  const ipc = fakePort('ipc', order);
  const { sab } = createSabRing({ payloadCapacity: 32 });
  return {
    spec: {
      entry: {
        kind: 'url',
        url: 'https://example.invalid/entry.js',
        capabilityPorts: { 'test.capability': capability },
      },
      argv: [],
      env: {},
      cwd: '/',
      stdio: { stdout, stderr, stdin, ipc },
      syncRing: sab,
      payloadCapacity: 32,
      pid: 2,
      ppid: 1,
    },
    fixed: [stdout, stderr, stdin, ipc],
  };
}

describe('worker-entry capability setup transaction', () => {
  beforeEach(() => {
    setKernelPreEntryHook(null);
    setKernelDrainHook(null);
    vi.stubGlobal('WorkerGlobalScope', class WorkerGlobalScope {});
    vi.stubGlobal('postMessage', vi.fn());
    Reflect.deleteProperty(globalThis, 'window');
    for (const key of [
      KERNEL_SYNC_CALL_KEY,
      KERNEL_PROCESS_SPEC_KEY,
      KERNEL_ENTRY_BOOTSTRAP_KEY,
      KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
    ]) {
      Reflect.deleteProperty(globalThis, key);
    }
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

  it.each([
    ['sync publication', KERNEL_SYNC_CALL_KEY],
    ['process publication', KERNEL_PROCESS_SPEC_KEY],
    ['entry bootstrap publication', KERNEL_ENTRY_BOOTSTRAP_KEY],
    ['capability publication', KERNEL_ENTRY_CAPABILITY_PORTS_KEY],
  ])('reaps the realm when %s fails', async (_label, faultKey) => {
    const capability = new MessageChannel();
    const capabilityClose = vi.spyOn(capability.port2, 'close');
    const { spec, fixed } = makeSpec(capability.port2);
    const target = new DispatchableWorkerTarget();
    const fault = new Error(`${faultKey}-failed`);
    vi.spyOn(Object, 'defineProperty').mockImplementation((object, key, descriptor) => {
      if (object === globalThis && key === faultKey) throw fault;
      return OriginalObjectDefineProperty(object, key, descriptor);
    });
    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

    await target.init(spec);

    expect(target.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 1 });
    expect(target.close).toHaveBeenCalledTimes(1);
    for (const port of fixed) expect(port.close).toHaveBeenCalledTimes(1);
    expect(capabilityClose).toHaveBeenCalledTimes(1);
    const stderrBytes = fixed[1]?.postMessage.mock.calls[0]?.[0] as Uint8Array;
    expect(new TextDecoder().decode(stderrBytes)).toContain(`${faultKey}-failed`);
    capability.port1.close();
  });

  it('reaps fixed and capability ports when SAB attach fails before publication', async () => {
    const capability = new MessageChannel();
    const capabilityClose = vi.spyOn(capability.port2, 'close');
    const made = makeSpec(capability.port2);
    const spec: WorkerSpawnSpec = {
      ...made.spec,
      syncRing: new SharedArrayBuffer(64),
    };
    const target = new DispatchableWorkerTarget();
    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

    await target.init(spec);

    expect(target.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 1 });
    expect(target.close).toHaveBeenCalledTimes(1);
    for (const port of made.fixed) expect(port.close).toHaveBeenCalledTimes(1);
    expect(capabilityClose).toHaveBeenCalledTimes(1);
    capability.port1.close();
  });

  it.each([
    {
      label: 'pre-entry',
      url: 'data:text/javascript,export%20{}',
      importOutcome: 'unused',
      installFault: (fault: Error) =>
        setKernelPreEntryHook(() => {
          throw fault;
        }),
    },
    {
      label: 'entry import',
      url: 'https://example.invalid/failing-entry.js',
      importOutcome: 'reject',
      installFault: (_fault: Error) => {},
    },
    {
      label: 'drain',
      url: 'https://example.invalid/clean-entry.js',
      importOutcome: 'resolve',
      installFault: (fault: Error) =>
        setKernelDrainHook(async () => {
          throw fault;
        }),
    },
  ])('reaps ports and realm in stderr/exit/close order after $label failure', async (faultCase) => {
    const order: string[] = [];
    const capability = new MessageChannel();
    const nativeCapabilityClose = capability.port2.close.bind(capability.port2);
    const capabilityClose = vi.spyOn(capability.port2, 'close');
    capabilityClose.mockImplementation(() => {
      order.push('close:capability');
      nativeCapabilityClose();
    });
    const made = makeSpec(capability.port2, order);
    if (made.spec.entry.kind !== 'url') throw new Error('expected URL test entry');
    const spec: WorkerSpawnSpec = {
      ...made.spec,
      entry: { ...made.spec.entry, url: faultCase.url },
    };
    const target = new DispatchableWorkerTarget(order);
    const fault = new Error(`${faultCase.label}-failed`);
    faultCase.installFault(fault);
    if (faultCase.importOutcome !== 'unused') {
      vi.stubGlobal(
        'eval',
        vi.fn(() => async () => {
          if (faultCase.importOutcome === 'reject') throw fault;
        }),
      );
    }
    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

    await target.init(spec);

    expect(target.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 1 });
    expect(target.close).toHaveBeenCalledTimes(1);
    for (const port of made.fixed) expect(port.close).toHaveBeenCalledTimes(1);
    expect(capabilityClose).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'post:stderr',
      'post:exit',
      'close:stdout',
      'close:stderr',
      'close:stdin',
      'close:ipc',
      'close:capability',
      'close:realm',
    ]);
    const stderrBytes = made.fixed[1]?.postMessage.mock.calls[0]?.[0] as Uint8Array;
    expect(new TextDecoder().decode(stderrBytes)).toContain(`${faultCase.label}-failed`);
    capability.port1.close();
  });
});
