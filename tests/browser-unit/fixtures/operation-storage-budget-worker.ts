import type { WorkerProcessHandle } from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { installOpfsFs } from '@riftydev/vfs/internal';
/// <reference lib="webworker" />
import { EventEmitter } from '../../../packages/io/src/index.ts';
import {
  validateUrlContext,
  validateWorkbenchOptions,
} from '../../../packages/workbench/src/workbench/internal/workbench-options.ts';
import type { BrowserOwnerDependencies } from '../../../packages/workbench/src/workbench/workbench-browser-owner-spawn.ts';
import { startBrowserWorkspaceOwner } from '../../../packages/workbench/src/workbench/workbench-browser-owner.ts';
import { runWorkbenchOwner } from '../../../packages/workbench/src/workers/workbench-owner-runtime.ts';
import { installWorkbenchOwnerStorageAuthority } from '../../../packages/workbench/src/workers/workbench-owner-storage.ts';
import { installBundleLocalBuffer } from '../../../packages/workbench/src/workers/worker-runtime-globals.ts';
import {
  type ProofBoundary,
  manualClock,
  nativePause,
  observe,
} from './operation-budget-native-boundary.ts';

declare const self: DedicatedWorkerGlobalScope;
interface Request {
  readonly kind: 'drain' | 'owner-proof' | 'storage-proof';
  readonly timeoutMs?: number;
  readonly boundary?: ProofBoundary;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function until(predicate: () => boolean, pump: () => Promise<void>, label: string) {
  const limit = performance.now() + 15_000;
  while (!predicate()) {
    if (performance.now() >= limit) throw new Error(`Native harness never reached ${label}`);
    await pump();
  }
}

async function drain(request: Request) {
  const clock = manualClock();
  const pause = await nativePause(`i7-drain-${crypto.randomUUID()}`, 'close', (path) =>
    /\/hold-\d+\.bin$/.test(path),
  );
  // Candidate overload is ignored by baseline; actual native I/O gives semantic RED.
  const install = installOpfsFs as (
    root?: FileSystemDirectoryHandle,
    options?: { readonly ioReportTimeoutMs?: number },
  ) => ReturnType<typeof installOpfsFs>;
  const options = request.timeoutMs === undefined ? {} : { ioReportTimeoutMs: request.timeoutMs };
  const pair = await install(pause.root, options);
  // Capture once per installation: caller mutation cannot shrink an active instance.
  if (request.timeoutMs !== undefined) options.ioReportTimeoutMs = 1;
  try {
    // Fill the existing 16 native lanes, then queue one same-path and one capacity dependent.
    for (let index = 0; index < 16; index++)
      pair.fsSync.writeFileSync(`/hold-${index}.bin`, encoder.encode(`first-${index}`));
    await until(() => pause.paused.size === 16, clock.pump, '16 active native closes');
    pair.fsSync.writeFileSync('/hold-0.bin', encoder.encode('second-0'));
    pair.fsSync.writeFileSync('/capacity.bin', encoder.encode('capacity'));
    const observed = observe(pair.fsSync.flush());
    const budget = request.timeoutMs ?? 30_000;
    const checks: Record<string, unknown> = {};
    for (const time of [
      ...new Set([Math.min(29_999, budget - 1), budget, 30_001, 89_999, 90_000]),
    ].sort((a, b) => a - b)) {
      await clock.advanceTo(time);
      checks[String(time)] = {
        flush: observed.snapshot(),
        writes: [...pause.writes],
        closes: [...pause.closes],
      };
    }
    pause.release();
    await until(
      () => pause.closes.length === 18,
      clock.pump,
      'late native completion without resend',
    );
    const healed = await pair.fsSync.flush();
    const persisted = {
      samePath: decoder.decode(await pair.vfs.readFile('/hold-0.bin')),
      capacity: decoder.decode(await pair.vfs.readFile('/capacity.bin')),
    };
    return { checks, healed, persisted, writes: pause.writes, closes: pause.closes };
  } finally {
    pause.restore();
    clock.restore();
    pair.fsSync.closeAll();
  }
}

/** Only the kernel process transport boundary is adapted, over native FIFO MessagePorts. */
class NativeOwnerProcess extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly output = new EventEmitter();
  readonly ports = new MessageChannel();
  readonly sent: unknown[] = [];
  readonly received: unknown[] = [];
  constructor() {
    super();
    this.ports.port1.onmessage = (event) => {
      this.received.push(event.data);
      this.emit('message', event.data);
    };
  }
  send(frame: unknown): boolean {
    this.sent.push(structuredClone(frame));
    this.ports.port1.postMessage(frame);
    return true;
  }
  stdout() {
    return this.output;
  }
  stderr() {
    return this.output;
  }
  kill(signal = 'SIGTERM'): boolean {
    this.emit('exit', null, signal);
    return true;
  }
  start() {
    void runWorkbenchOwner({
      onMessage: (receive) => {
        this.ports.port2.onmessage = (event) => receive(event.data);
      },
      send: (frame) => this.ports.port2.postMessage(frame),
    }).then(
      () => this.emit('exit', 0, null),
      (error: unknown) => this.emit('peererror', error),
    );
  }
  dispose() {
    this.ports.port1.close();
    this.ports.port2.close();
  }
}

function bootstrapOwnerRealm() {
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: { stdout: { write: () => true }, stderr: { write: () => true }, env: {} },
  });
  registerNetBuiltins();
  registerSqliteBuiltin();
  installBundleLocalBuffer();
  setProcessCwd('/');
}

async function proof(request: Request) {
  bootstrapOwnerRealm();
  const clock = manualClock();
  const namespace = `i7-proof-${crypto.randomUUID()}`;
  const pause = await nativePause(namespace, request.boundary ?? 'close', (path) =>
    path.includes('/.rifty/workbench/v1/storage-proof/'),
  );
  const processBoundary = new NativeOwnerProcess();
  let close: (() => Promise<unknown>) | undefined;
  try {
    let readSnapshot: () => unknown;
    let opening: Promise<unknown>;
    if (request.kind === 'storage-proof') {
      // Existing proofTimeoutMs alone is NOT new RED. This isolates new default-installer I/O forwarding.
      const options = { namespace, proofTimeoutMs: 90_000, ioReportTimeoutMs: 90_000 };
      opening = installWorkbenchOwnerStorageAuthority('preferred', options).then(
        (authority) => authority.snapshot,
      );
      let snapshot: unknown;
      void opening.then((value) => {
        snapshot = value;
      });
      readSnapshot = () => snapshot;
    } else {
      const origin = new URL(self.location.href).origin;
      const normalized = validateWorkbenchOptions(
        {
          deployment: {
            workers: {
              owner: '/unused-owner.js',
              kernel: '/unused-kernel.js',
              node: '/unused-node.js',
              devServer: '/unused-dev.js',
            },
            serviceWorker: { url: '/unused-sw.js', scope: '/' },
            wasm: { sqlite: '/unused-sqlite.wasm' },
            ...(request.timeoutMs === undefined
              ? {}
              : { ownerStartupTimeoutMs: request.timeoutMs }),
          },
          packageAcquisition: { mode: 'snapshot-only' },
          storage: { persistence: 'preferred', namespace },
        },
        validateUrlContext({ apiBaseUrl: `${origin}/`, clientUrl: `${origin}/unit-harness.html` }),
      );
      const unused = (): never => {
        throw new Error('Unneeded browser effect reached in storage-only startup');
      };
      const dependencies: BrowserOwnerDependencies = {
        spawnOwner: () => {
          processBoundary.start();
          return processBoundary as unknown as WorkerProcessHandle;
        },
        serviceWorker: {
          controller: null,
          ready: new Promise<never>(() => {}),
          addEventListener: unused,
          removeEventListener: unused,
        } as unknown as BrowserOwnerDependencies['serviceWorker'],
        timers: {
          setTimeout: (callback, ms) => self.setTimeout(callback, ms),
          clearTimeout: (id) => clearTimeout(id),
        },
        fetch: unused,
        mountPreview: unused,
        operationId: () => crypto.randomUUID(),
      };
      // Raw browser composition deliberately leaves outer ready-timer proof to existing ingress carrier.
      const raw = startBrowserWorkspaceOwner(
        { ...normalized.owner, storage: normalized.storage },
        dependencies,
      );
      opening = raw.ready;
      readSnapshot = () => raw.storageSnapshot();
      close = async () => {
        raw.close();
        await raw.closed;
      };
    }
    const observed = observe(opening);
    await until(
      () => pause.paused.size === 1 || observed.snapshot().state === 'rejected',
      clock.pump,
      'native proof boundary',
    );
    await clock.advanceTo(30_001);
    // Native cleanup/read may finish asynchronously after the timeout continuation.
    for (let i = 0; i < 4; i++) await clock.pump();
    const at30 = observed.snapshot();
    await clock.advanceTo(40_000);
    pause.release();
    await until(
      () => observed.snapshot().state !== 'pending',
      clock.pump,
      'storage selection after native release',
    );
    const result = {
      at30,
      final: observed.snapshot(),
      storage: readSnapshot(),
      nativeReads: pause.reads,
      nativeWrites: pause.writes,
      boot: processBoundary.sent[0],
      messages: processBoundary.received,
    };
    await close?.();
    close = undefined;
    return result;
  } finally {
    pause.restore();
    clock.restore();
    processBoundary.dispose();
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  void (event.data.kind === 'drain' ? drain(event.data) : proof(event.data)).then(
    (result) => self.postMessage(JSON.parse(JSON.stringify({ ok: true, result }))),
    (error: unknown) =>
      self.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) }),
  );
};
