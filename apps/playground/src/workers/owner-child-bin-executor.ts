/**
 * Owner-realm child `BinExecutor` (ADR-0150: foreground CLIs run in a supervised
 * child worker reading the owner fs over sync-RPC; owner stays a free async
 * supervisor). Each resolved `.bin`/node
 * CLI runs in a supervised child worker-process that reads+writes the owner
 * store over `fs.*` sync-RPC. The child is serve-capable:
 * run-to-completion CLIs still exit through node-entry lifecycle, while CLIs
 * that listen() stay alive and post their ports like `node <file>`.
 * The owner stays responsive (blocking work left its thread — ADR-0150
 * invariant). Stream/kill/exit reuse `glue/bin-executor.ts`'s createBinExecutor.
 */

import {
  type KernelEntryCapabilityPorts,
  type SpawnWorkerSpec,
  globalProcessManager,
} from '@riftydev/kernel';
import { buildNodeEntryWorkerEntry } from '@riftydev/runtime-js/builtins/node-entry-url';
import type { BinExecutor } from '@riftydev/shell';
import {
  type BinExecutorDeps,
  type BinSpawnRequest,
  type BinWorkerHandle,
  prepareBinSpawnRequest,
  superviseBinWorker,
} from '../glue/bin-executor.ts';
import { childTerminalBootstrap } from '../glue/child-terminal.ts';
import { type OwnerChildAdmissionAuthority, admitOwnerChild } from './owner-child-admission.ts';
import { prepareViteBinSpawnRequest } from './vite-cli-prep.ts';

/** Pure: build the spawn spec for a resolved bin request (unit-tested). */
export function buildChildSpawnSpec(
  req: BinSpawnRequest,
  nodeEntryUrl: string,
  nodeWorkerRuntimeEnv: Readonly<Record<string, string>>,
  capabilityPorts?: KernelEntryCapabilityPorts,
): SpawnWorkerSpec {
  return {
    entry: {
      ...buildNodeEntryWorkerEntry(nodeEntryUrl, nodeWorkerRuntimeEnv, {
        kind: 'program',
        bin: true,
        remoteFs: true,
        ...(req.remoteFsRoot === undefined ? {} : { remoteFsRoot: req.remoteFsRoot }),
        nodeServe: true,
        ...(req.previewScope === undefined ? {} : { previewScope: req.previewScope }),
        terminal: childTerminalBootstrap(req),
      }),
      ...(capabilityPorts === undefined ? {} : { capabilityPorts }),
    },
    argv: ['rifty', req.shimPath, ...req.args],
    env: { ...req.env },
    cwd: req.cwd,
    serve: true,
  };
}

type OwnerChildBinRequestEnricher = (request: BinSpawnRequest) => BinSpawnRequest;

/** Apply mandatory runtime policy before an owner may add app-local metadata. */
export function prepareOwnerChildBinSpawnRequest(
  request: BinSpawnRequest,
  enrichRequest?: OwnerChildBinRequestEnricher,
): BinSpawnRequest {
  const prepared = prepareViteBinSpawnRequest(request);
  return enrichRequest?.(prepared) ?? prepared;
}

/** Build the owner's child-spawning BinExecutor. `nodeEntryUrl` = node-entry bootstrap worker URL. */
export function createOwnerChildBinExecutor(
  nodeEntryUrl: string,
  nodeWorkerRuntimeEnv: Readonly<Record<string, string>>,
  hooks: Pick<BinExecutorDeps, 'onStart' | 'onMessage' | 'onExit'> = {},
  enrichRequest?: OwnerChildBinRequestEnricher,
  admission?: OwnerChildAdmissionAuthority,
): BinExecutor {
  return async (binPath, args, ctx) => {
    const req = prepareBinSpawnRequest(binPath, args, ctx, (request) =>
      prepareOwnerChildBinSpawnRequest(request, enrichRequest),
    );
    return admitOwnerChild({
      ...(admission === undefined ? {} : { authority: admission }),
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      beforeSpawn: () => hooks.onStart?.(req, ctx),
      spawn: (capabilityPorts): BinWorkerHandle => {
        const handle = globalProcessManager.spawnWorker(
          req.shimPath,
          buildChildSpawnSpec(req, nodeEntryUrl, nodeWorkerRuntimeEnv, capabilityPorts),
          1,
        );
        if (handle.kind !== 'worker') {
          throw new Error(`owner-child-bin-executor: expected worker handle, got ${handle.kind}`);
        }
        // After the kind guard, TS narrows to WorkerProcessHandle, which structurally
        // satisfies BinWorkerHandle: stdout()/stderr() return Readable (has on('data',...));
        // on(event,listener) returns `this` (assignable to `unknown`); kill() returns
        // boolean (assignable to `unknown`). No cast needed.
        return handle;
      },
      supervise: (handle, lifecycle) =>
        superviseBinWorker(hooks, req, handle, ctx, () => {
          void lifecycle.dispose();
        }),
    });
  };
}
