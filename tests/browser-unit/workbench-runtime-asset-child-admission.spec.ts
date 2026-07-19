import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const kernelModuleUrl = `/@fs${workspacePath}/packages/kernel/src/index.ts`;
const npmClientModuleUrl = `/@fs${workspacePath}/packages/npm-client/src/index.ts`;
const shadowRegistryModuleUrl = `/@fs${workspacePath}/tools/shadow-registry/src/index.ts`;
const capabilityEntryUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/runtime-asset-capability-entry.ts`;
const ownerChildNodeExecutorUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/workbench-owner-child-node-executor.ts`;

test('a real supervised child transfers its exact admitted asset peer and cleans the session', async ({
  page,
}) => {
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ entryUrl, kernelUrl, nodeExecutorUrl, npmClientUrl, shadowRegistryUrl }) => {
      interface ShadowAssetPlan {
        readonly requiredSetDigest: string;
        readonly substitutions: readonly Readonly<Record<string, unknown>>[];
        readonly assets: readonly Readonly<{
          id: string;
          source: Readonly<{ name: string; version: string; integrity: string }>;
          member: string;
          memberSha256: string;
          memberSize: number;
        }>[];
      }
      type ProcessExit = { readonly code: number | null; readonly signal: string | null };
      type ChildHandle = {
        readonly kind: 'worker';
        stdout(): { on(event: 'data', listener: (chunk: unknown) => void): unknown };
        stderr(): { on(event: 'data', listener: (chunk: unknown) => void): unknown };
        stdin(): {
          write(chunk: Uint8Array, callback: (error?: Error | null) => void): unknown;
          end(): unknown;
          once(event: 'finish' | 'error', listener: (...args: unknown[]) => void): unknown;
          removeListener(
            event: 'finish' | 'error',
            listener: (...args: unknown[]) => void,
          ): unknown;
        };
        on(event: string, listener: (...args: unknown[]) => void): unknown;
        once(event: 'exit', listener: (...args: unknown[]) => void): unknown;
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
          plan: ShadowAssetPlan;
          receipt: Readonly<{
            schema: 1;
            receiptSha256: string;
            requiredSetDigest: string;
            catalog: Readonly<{ id: string; digest: string }>;
            storageClass: 'memory-session';
            substitutions: ShadowAssetPlan['substitutions'];
            assets: readonly Readonly<Record<string, unknown>>[];
          }>;
        }>;
        commit(): void;
        abortBeforeSpawn(error: unknown): void;
        abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
      };
      type AdmissionAuthority = {
        reserve(): Promise<Reservation>;
        runtimeReader(plan: ShadowAssetPlan): {
          readVerified(
            assetId: string,
            options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>,
          ): Promise<Uint8Array>;
        };
      };
      type ExecutorFactory = (
        nodeEntryUrl: string,
        runtimeEnv: Readonly<Record<string, string>>,
        spawn: (spec: SpawnSpec) => ChildHandle,
        admission: AdmissionAuthority,
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
      type CapabilityProof = Readonly<{
        kind: 'runtime-asset-capability-ready';
        assetId: string;
        capabilityKeys: string[];
      }>;

      function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
        });
        return Promise.race([promise, timeout]).finally(() => {
          if (timer !== undefined) clearTimeout(timer);
        });
      }

      const [kernel, nodeExecutor, npmClient, shadowRegistry] = await Promise.all([
        import(kernelUrl),
        import(nodeExecutorUrl),
        import(npmClientUrl),
        import(shadowRegistryUrl),
      ]);
      const catalog = shadowRegistry.builtinShadowAssetCatalog as Readonly<{
        id: string;
        digest: string;
      }>;
      const plan = npmClient.planBuiltinShadowAssets([
        {
          catalog: { id: catalog.id, digest: catalog.digest },
          publicName: 'esbuild',
          requestedRange: '^0.28.0',
          resolvedPublicVersion: '0.28.0',
          substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
          runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
          builtin: true,
        },
      ]) as ShadowAssetPlan;
      const asset = plan.assets[0];
      if (asset === undefined) throw new Error('fixture expected one runtime asset');
      const capabilityName = npmClient.SHADOW_ASSET_CAPABILITY as string;

      const manager = new kernel.ProcessManager() as {
        spawnWorker(command: string, spec: SpawnSpec, ppid?: number): ChildHandle;
        list(): ChildHandle[];
      };
      let resolveReservation!: (reservation: Reservation) => void;
      const reservationGate = new Promise<Reservation>((resolve) => {
        resolveReservation = resolve;
      });
      let resolveProof!: (proof: CapabilityProof) => void;
      const proofGate = new Promise<CapabilityProof>((resolve) => {
        resolveProof = resolve;
      });
      let resolveReadStarted!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        resolveReadStarted = resolve;
      });
      let resolveReaderAborted!: () => void;
      const readerAborted = new Promise<void>((resolve) => {
        resolveReaderAborted = resolve;
      });
      let resolvePublished!: () => void;
      const published = new Promise<void>((resolve) => {
        resolvePublished = resolve;
      });

      const events: string[] = [];
      let physicalSpawns = 0;
      let commitCalls = 0;
      let abortBeforeCalls = 0;
      let abortAfterCalls = 0;
      let runtimeReaderCalls = 0;
      let readCalls = 0;
      let readerAbortCalls = 0;
      let publicationCalls = 0;
      let publicationBeforeCommit = false;
      let transferredKeys: string[] = [];
      const reservation: Reservation = {
        readiness: Object.freeze({
          kind: 'ready',
          plan,
          receipt: Object.freeze({
            schema: 1,
            receiptSha256: 'b'.repeat(64),
            requiredSetDigest: plan.requiredSetDigest,
            catalog: Object.freeze({ id: catalog.id, digest: catalog.digest }),
            storageClass: 'memory-session',
            substitutions: plan.substitutions,
            assets: plan.assets.map((entry) =>
              Object.freeze({
                id: entry.id,
                source: entry.source,
                member: entry.member,
                memberSha256: entry.memberSha256,
                memberSize: entry.memberSize,
                fillTransport: 'standard',
                fillCache: 'network',
              }),
            ),
          }),
        }),
        commit: () => {
          events.push('commit');
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

      const factory = nodeExecutor.createOwnerChildNodeExecutor as unknown as ExecutorFactory;
      const executor = factory(
        'unused:node-entry',
        {
          RIFTY_KERNEL_WORKER_URL: 'unused:kernel',
          RIFTY_NODE_ENTRY_WORKER_URL: 'unused:node-entry',
          RIFTY_SQLITE_WASM_URL: 'unused:sqlite',
        },
        (spec) => {
          if (spec.entry.kind !== 'url') throw new Error('expected URL child entry');
          transferredKeys = Object.keys(spec.entry.capabilityPorts ?? {});
          const transferredPeer = spec.entry.capabilityPorts?.[capabilityName];
          if (!(transferredPeer instanceof MessagePort)) {
            throw new Error('physical spawn did not receive the exact MessagePort capability');
          }
          events.push('spawn');
          physicalSpawns += 1;
          const child = manager.spawnWorker(
            'runtime-asset-admission-proof',
            { ...spec, entry: { ...spec.entry, url: entryUrl } },
            1,
          );
          child.on('message', (message: unknown) => {
            const candidate = message as Partial<CapabilityProof>;
            if (candidate.kind !== 'runtime-asset-capability-ready') return;
            if (typeof candidate.assetId !== 'string' || !Array.isArray(candidate.capabilityKeys)) {
              throw new Error('child sent a malformed runtime-asset capability proof');
            }
            resolveProof({
              kind: candidate.kind,
              assetId: candidate.assetId,
              capabilityKeys: candidate.capabilityKeys,
            });
          });
          return child;
        },
        {
          reserve: () => reservationGate,
          runtimeReader: (attestedPlan) => {
            runtimeReaderCalls += 1;
            if (attestedPlan !== plan) {
              throw new Error('runtime reader did not receive the reserved plan identity');
            }
            return {
              readVerified: (assetId, options) => {
                readCalls += 1;
                if (assetId !== asset.id) throw new Error('child requested a drifted asset id');
                const signal = options?.signal;
                if (signal === undefined) throw new Error('server read omitted its cleanup signal');
                resolveReadStarted();
                return new Promise<Uint8Array>((_resolve, reject) => {
                  const onAbort = (): void => {
                    readerAbortCalls += 1;
                    resolveReaderAborted();
                    reject(new DOMException('session disposed', 'AbortError'));
                  };
                  if (signal.aborted) onAbort();
                  else signal.addEventListener('abort', onAbort, { once: true });
                });
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
        {
          sid: 'runtime-asset-child',
          onListening: () => {
            publicationCalls += 1;
            publicationBeforeCommit ||= commitCalls === 0;
            events.push('publish');
            resolvePublished();
          },
          onExit: () => {},
        },
      );
      void execution.catch(() => {});

      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (physicalSpawns !== 0) {
          throw new Error(`physical child spawned before reservation settled: ${physicalSpawns}`);
        }

        resolveReservation(reservation);
        const [proof] = await Promise.all([
          withTimeout(proofGate, 'child capability proof'),
          withTimeout(readStarted, 'server runtime-asset read'),
          withTimeout(published, 'child publication'),
        ]);
        if (physicalSpawns !== 1) {
          throw new Error(`expected one physical spawn, got ${physicalSpawns}`);
        }
        if (commitCalls !== 1)
          throw new Error(`expected one reservation commit, got ${commitCalls}`);
        if (publicationBeforeCommit) throw new Error('child was published before admission commit');
        if (abortBeforeCalls !== 0 || abortAfterCalls !== 0) {
          throw new Error(`unexpected reservation aborts: ${abortBeforeCalls}/${abortAfterCalls}`);
        }
        if (runtimeReaderCalls !== 1 || readCalls !== 1) {
          throw new Error(
            `unexpected reader construction/read count: ${runtimeReaderCalls}/${readCalls}`,
          );
        }

        const [child] = manager.list();
        if (child === undefined) throw new Error('real child was not supervised');
        child.kill('SIGTERM');
        await execution;
        await withTimeout(readerAborted, 'runtime-asset session cleanup');
        await Promise.resolve();

        return {
          physicalSpawns,
          commitCalls,
          abortBeforeCalls,
          abortAfterCalls,
          runtimeReaderCalls,
          readCalls,
          readerAbortCalls,
          publicationCalls,
          publicationBeforeCommit,
          transferredKeys,
          childCapabilityKeys: proof.capabilityKeys,
          transferredAssetId: asset.id,
          childAssetId: proof.assetId,
          eventOrder: events,
          remainingChildren: manager.list().length,
        };
      } finally {
        resolveReservation(reservation);
        for (const child of manager.list()) child.kill('SIGTERM');
      }
    },
    {
      entryUrl: capabilityEntryUrl,
      kernelUrl: kernelModuleUrl,
      nodeExecutorUrl: ownerChildNodeExecutorUrl,
      npmClientUrl: npmClientModuleUrl,
      shadowRegistryUrl: shadowRegistryModuleUrl,
    },
  );

  expect(result).toEqual({
    physicalSpawns: 1,
    commitCalls: 1,
    abortBeforeCalls: 0,
    abortAfterCalls: 0,
    runtimeReaderCalls: 1,
    readCalls: 1,
    readerAbortCalls: 1,
    publicationCalls: 1,
    publicationBeforeCommit: false,
    transferredKeys: ['rifty.shadow-assets.v1'],
    childCapabilityKeys: ['rifty.shadow-assets.v1'],
    transferredAssetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
    childAssetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
    eventOrder: ['spawn', 'commit', 'publish'],
    remainingChildren: 0,
  });
});
