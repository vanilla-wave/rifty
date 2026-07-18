import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const kernelModuleUrl = `/@fs${workspacePath}/packages/kernel/src/index.ts`;
const capabilityEntryUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/runtime-asset-capability-entry.ts`;

test('a real supervised child cannot physically spawn before its attested reservation', async ({
  page,
}) => {
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ entryUrl, kernelUrl }) => {
      type ProcessExit = { readonly code: number | null; readonly signal: string | null };
      type ChildHandle = {
        readonly kind: 'worker';
        stdout(): { on(event: 'data', listener: (chunk: unknown) => void): unknown };
        stderr(): { on(event: 'data', listener: (chunk: unknown) => void): unknown };
        stdin(): { write(chunk: unknown): unknown; end(): unknown };
        on(event: string, listener: (...args: unknown[]) => void): unknown;
        send(message: unknown): unknown;
        resize(cols: number, rows: number): unknown;
        kill(signal?: string): unknown;
      };
      type SpawnSpec = {
        readonly entry:
          | { readonly kind: 'source'; readonly source: string }
          | {
              readonly kind: 'url';
              readonly url: string;
              readonly bootstrap?: unknown;
              readonly capabilityPorts?: Readonly<Record<string, MessagePort>>;
            };
        readonly argv: readonly string[];
        readonly env: Readonly<Record<string, string>>;
        readonly cwd: string;
        readonly serve?: boolean;
      };
      type Reservation = {
        readonly readiness: Readonly<{
          kind: 'ready';
          plan: Readonly<{ requiredSetDigest: string }>;
          receipt: Readonly<{ requiredSetDigest: string }>;
        }>;
        commit(): void;
        abortBeforeSpawn(error: unknown): void;
        abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
      };
      type AdmissionPort = {
        reserveChildAdmission(): Promise<Reservation>;
        createRuntimeAssetSession(plan: Reservation['readiness']['plan']): {
          readonly childPort: MessagePort;
          dispose(): void;
        };
      };
      type ExecutorFactory = (
        nodeEntryUrl: string,
        runtimeEnv: Readonly<Record<string, string>>,
        spawn: (spec: SpawnSpec) => ChildHandle,
        admission: AdmissionPort,
      ) => (
        entry: string,
        args: readonly string[],
        context: {
          cwd: string;
          env: Record<string, string>;
          stdout: { write(chunk: string | Uint8Array): unknown };
          stderr: { write(chunk: string | Uint8Array): unknown };
        },
        hooks: {
          sid: string;
          onListening(sid: string, ports: number[]): void;
          onExit(sid: string): void;
        },
      ) => Promise<ProcessExit>;

      const [kernel, nodeExecutor] = await Promise.all([
        import(kernelUrl),
        import('/src/workers/owner-child-node-executor.ts'),
      ]);
      const manager = new kernel.ProcessManager() as {
        spawnWorker(command: string, spec: SpawnSpec, ppid?: number): ChildHandle;
        list(): ChildHandle[];
      };
      let resolveReservation!: (reservation: Reservation) => void;
      const reservationGate = new Promise<Reservation>((resolve) => {
        resolveReservation = resolve;
      });
      const channel = new MessageChannel();
      channel.port1.start();
      let physicalSpawns = 0;
      let commitCalls = 0;
      let abortBeforeCalls = 0;
      let abortAfterCalls = 0;
      let disposeCalls = 0;
      const digest = 'd'.repeat(64);
      const reservation: Reservation = {
        readiness: Object.freeze({
          kind: 'ready',
          plan: Object.freeze({ requiredSetDigest: digest }),
          receipt: Object.freeze({ requiredSetDigest: digest }),
        }),
        commit: () => {
          commitCalls += 1;
        },
        abortBeforeSpawn: () => {
          abortBeforeCalls += 1;
        },
        abortAfterChildSettlement: async (_error, exited) => {
          abortAfterCalls += 1;
          await exited;
        },
      };
      const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('runtime-asset child capability did not become ready')),
          10_000,
        );
        channel.port1.onmessage = (event) => {
          const frame = event.data as Record<string, unknown>;
          if (frame.kind !== 'ready') return;
          clearTimeout(timer);
          resolve(frame);
        };
      });

      const factory = nodeExecutor.createOwnerChildNodeExecutor as unknown as ExecutorFactory;
      const executor = factory(
        'unused:node-entry',
        {
          RIFTY_KERNEL_WORKER_URL: 'unused:kernel',
          RIFTY_NODE_ENTRY_WORKER_URL: 'unused:node-entry',
          RIFTY_SQLITE_WASM_URL: 'unused:sqlite',
          RIFTY_ESBUILD_WASM_URL: 'unused:esbuild',
        },
        (spec) => {
          if (spec.entry.kind !== 'url') throw new Error('expected URL child entry');
          physicalSpawns += 1;
          return manager.spawnWorker(
            'runtime-asset-admission-proof',
            { ...spec, entry: { ...spec.entry, url: entryUrl } },
            1,
          );
        },
        {
          reserveChildAdmission: () => reservationGate,
          createRuntimeAssetSession: (attestedPlan) => {
            if (attestedPlan !== reservation.readiness.plan) {
              throw new Error('child session did not receive the reservation plan identity');
            }
            return {
              childPort: channel.port2,
              dispose: () => {
                disposeCalls += 1;
                channel.port1.close();
              },
            };
          },
        },
      );
      const execution = executor(
        '/src/server.mjs',
        [],
        {
          cwd: '/',
          env: {},
          stdout: { write: () => true },
          stderr: { write: () => true },
        },
        { sid: 'runtime-asset-child', onListening: () => {}, onExit: () => {} },
      );
      void execution.catch(() => {});

      try {
        await Promise.resolve();
        if (physicalSpawns !== 0) {
          throw new Error(`physical child spawned before reservation settled: ${physicalSpawns}`);
        }

        resolveReservation(reservation);
        await ready;
        if (physicalSpawns !== 1)
          throw new Error(`expected one physical spawn, got ${physicalSpawns}`);
        if (commitCalls !== 1)
          throw new Error(`expected one reservation commit, got ${commitCalls}`);
        if (abortBeforeCalls !== 0) {
          throw new Error(`unexpected pre-spawn abort count: ${abortBeforeCalls}`);
        }
        if (abortAfterCalls !== 0) {
          throw new Error(`unexpected post-spawn abort count: ${abortAfterCalls}`);
        }

        const [child] = manager.list();
        if (child === undefined) throw new Error('real child was not supervised');
        child.kill('SIGTERM');
        await execution;
        await Promise.resolve();

        return {
          physicalSpawns,
          commitCalls,
          abortBeforeCalls,
          abortAfterCalls,
          disposeCalls,
          remainingChildren: manager.list().length,
        };
      } finally {
        resolveReservation(reservation);
        for (const child of manager.list()) child.kill('SIGTERM');
        channel.port1.close();
        try {
          channel.port2.close();
        } catch {
          // The real Worker transfer may already own this endpoint.
        }
      }
    },
    { entryUrl: capabilityEntryUrl, kernelUrl: kernelModuleUrl },
  );

  expect(result).toEqual({
    physicalSpawns: 1,
    commitCalls: 1,
    abortBeforeCalls: 0,
    abortAfterCalls: 0,
    disposeCalls: 1,
    remainingChildren: 0,
  });
});
