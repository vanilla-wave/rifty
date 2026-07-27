import { describe, expect, it, vi } from 'vitest';
import { finalizeWorkerEntry, installWorkerPeerCloseAttestation } from '../src/worker-entry.ts';
import type { WorkerSpawnSpec, WorkerStdioPorts } from '../src/worker-entry.ts';
import { createWorkerOutputState, workerOutputAttestation } from '../src/worker-stdio-drain.ts';

/**
 * ADR-0144 (the serve-worker gate for ADR-0143 single-store-owner): a `serve` worker whose entry finishes
 * setup WITHOUT throwing must NOT be reaped — no exit message, no port close,
 * no `self.close()`. A run-to-completion worker (no `serve`) reaps as before;
 * a `serve` worker that THREW during setup still reaps (a crash must not
 * linger). `finalizeWorkerEntry` is the pure, realm-independent decision so it
 * is testable without a Worker realm (the full SAB `onMessage` path needs COI).
 */

function fakePort(): MessagePort & {
  close: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
} {
  return { close: vi.fn(), postMessage: vi.fn() } as unknown as MessagePort & {
    close: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  };
}

function makeSpec(serve: boolean | undefined): {
  spec: WorkerSpawnSpec;
  ports: Record<keyof WorkerStdioPorts | 'capability', ReturnType<typeof vi.fn>>;
} {
  const stdout = fakePort();
  const stderr = fakePort();
  const stdin = fakePort();
  const ipc = fakePort();
  const capability = fakePort();
  const spec = {
    entry: {
      kind: 'url',
      url: 'https://example.invalid/entry.js',
      capabilityPorts: { 'rifty.shadow-assets.ready/v1': capability },
    },
    argv: [],
    env: {},
    cwd: '/',
    stdio: { stdout, stderr, stdin, ipc },
    outputState: createWorkerOutputState(),
    syncRing: new SharedArrayBuffer(64),
    pid: 2,
    ppid: 1,
    serve,
  } as unknown as WorkerSpawnSpec;
  return {
    spec,
    ports: {
      stdout: stdout.close,
      stderr: stderr.close,
      stdin: stdin.close,
      ipc: ipc.close,
      capability: capability.close,
    },
  };
}

function fakeTarget(): {
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { postMessage: vi.fn(), close: vi.fn() };
}

describe('finalizeWorkerEntry (ADR-0144 kernel server-process model)', () => {
  it('attests an abrupt realm close on the exact control port before physical close', () => {
    const events: string[] = [];
    const target = {
      postMessage: vi.fn(),
      close: vi.fn(() => events.push('close')),
    };
    const { spec } = makeSpec(undefined);
    spec.stdio.ipc.postMessage = vi.fn(() => events.push('peer-closing'));
    installWorkerPeerCloseAttestation(target, spec);

    target.close();

    expect(events).toEqual(['peer-closing', 'close']);
    expect(spec.stdio.ipc.postMessage).toHaveBeenCalledWith({ kind: 'control:peer-closing' });
  });

  it('keeps a serve worker alive when its entry resolved without throwing', () => {
    const target = fakeTarget();
    const { spec, ports } = makeSpec(true);

    finalizeWorkerEntry(target as unknown as DedicatedWorkerGlobalScope, spec, {
      threw: false,
      code: 0,
    });

    expect(target.postMessage).not.toHaveBeenCalled();
    expect(target.close).not.toHaveBeenCalled();
    expect(ports.stdout).not.toHaveBeenCalled();
    expect(ports.ipc).not.toHaveBeenCalled();
    expect(ports.capability).not.toHaveBeenCalled();
  });

  it('reaps a run-to-completion worker (no serve): exit message + close ports + self.close', () => {
    const target = fakeTarget();
    const { spec, ports } = makeSpec(undefined);

    finalizeWorkerEntry(target as unknown as DedicatedWorkerGlobalScope, spec, {
      threw: false,
      code: 0,
    });

    expect(target.postMessage).toHaveBeenCalledWith({
      type: 'exit',
      code: 0,
      attestation: workerOutputAttestation(spec.outputState),
    });
    expect(spec.stdio.ipc.postMessage).not.toHaveBeenCalled();
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(ports.stdout).toHaveBeenCalledTimes(1);
    expect(ports.stderr).toHaveBeenCalledTimes(1);
    expect(ports.stdin).toHaveBeenCalledTimes(1);
    expect(ports.ipc).toHaveBeenCalledTimes(1);
    expect(ports.capability).toHaveBeenCalledTimes(1);
  });

  it('reaps a serve worker that THREW during setup (a crash must not linger)', () => {
    const target = fakeTarget();
    const { spec, ports } = makeSpec(true);

    finalizeWorkerEntry(target as unknown as DedicatedWorkerGlobalScope, spec, {
      threw: true,
      code: 1,
    });

    expect(target.postMessage).toHaveBeenCalledWith({
      type: 'exit',
      code: 1,
      attestation: workerOutputAttestation(spec.outputState),
    });
    expect(spec.stdio.ipc.postMessage).not.toHaveBeenCalled();
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(ports.capability).toHaveBeenCalledTimes(1);
  });

  it('reaps an explicit serve:false worker', () => {
    const target = fakeTarget();
    const { spec } = makeSpec(false);

    finalizeWorkerEntry(target as unknown as DedicatedWorkerGlobalScope, spec, {
      threw: false,
      code: 0,
    });

    expect(target.postMessage).toHaveBeenCalledWith({
      type: 'exit',
      code: 0,
      attestation: workerOutputAttestation(spec.outputState),
    });
    expect(target.close).toHaveBeenCalledTimes(1);
  });

  it('closes every endpoint and realm when posting exit itself fails', () => {
    const target = fakeTarget();
    target.postMessage.mockImplementation(() => {
      throw new Error('exit post failed');
    });
    const { spec, ports } = makeSpec(undefined);

    expect(() =>
      finalizeWorkerEntry(target as unknown as DedicatedWorkerGlobalScope, spec, {
        threw: false,
        code: 0,
      }),
    ).toThrow('exit post failed');

    expect(ports.stdout).toHaveBeenCalledTimes(1);
    expect(ports.stderr).toHaveBeenCalledTimes(1);
    expect(ports.stdin).toHaveBeenCalledTimes(1);
    expect(ports.ipc).toHaveBeenCalledTimes(1);
    expect(ports.capability).toHaveBeenCalledTimes(1);
    expect(target.close).toHaveBeenCalledTimes(1);
  });
});
