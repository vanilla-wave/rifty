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
import type { BinExecutorDeps, BinSpawnRequest, BinWorkerHandle } from '../glue/bin-executor.ts';
import { childTerminalBootstrap } from '../glue/child-terminal.ts';
import { runForegroundChild } from '../glue/run-foreground-child.ts';
import {
  type ReserveOwnerChildAdmission,
  abortOwnerChildAdmissionAfterSpawn,
  abortOwnerChildAdmissionBeforeSpawn,
  attachOwnerChildCapabilities,
  commitOwnerChildAdmission,
  observeOwnerChildExit,
} from './owner-child-admission.ts';
import { prepareViteBinSpawnRequest } from './vite-cli-prep.ts';

/** Pure: build the spawn spec for a resolved bin request (unit-tested). */
export function buildChildSpawnSpec(
  req: BinSpawnRequest,
  nodeEntryUrl: string,
  nodeWorkerRuntimeEnv: Readonly<Record<string, string>>,
  capabilityPorts?: KernelEntryCapabilityPorts,
): SpawnWorkerSpec {
  const entry = buildNodeEntryWorkerEntry(nodeEntryUrl, nodeWorkerRuntimeEnv, {
    kind: 'program',
    bin: true,
    remoteFs: true,
    ...(req.remoteFsRoot === undefined ? {} : { remoteFsRoot: req.remoteFsRoot }),
    nodeServe: true,
    ...(req.previewScope === undefined ? {} : { previewScope: req.previewScope }),
    terminal: childTerminalBootstrap(req),
  });
  return {
    entry:
      capabilityPorts === undefined ? entry : attachOwnerChildCapabilities(entry, capabilityPorts),
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
  reserveAdmission: ReserveOwnerChildAdmission,
  hooks: Pick<BinExecutorDeps, 'onStart' | 'onSpawn' | 'onMessage' | 'onExit'> = {},
  enrichRequest?: OwnerChildBinRequestEnricher,
): BinExecutor {
  return async (binPath, args, ctx) => {
    const req = prepareOwnerChildBinSpawnRequest(
      {
        shimPath: binPath,
        args,
        env: ctx.env,
        cwd: ctx.cwd,
        isTTY: ctx.isTTY === true,
        cols: ctx.cols,
        rows: ctx.rows,
      },
      enrichRequest,
    );
    const reservation = await reserveAdmission(req.shimPath);
    let handle: BinWorkerHandle;
    try {
      hooks.onStart?.(req, ctx);
      const spawned = globalProcessManager.spawnWorker(
        req.shimPath,
        buildChildSpawnSpec(
          req,
          nodeEntryUrl,
          nodeWorkerRuntimeEnv,
          reservation.snapshot.capabilityPorts,
        ),
        1,
      );
      if (spawned.kind !== 'worker') {
        throw new Error(`owner-child-bin-executor: expected worker handle, got ${spawned.kind}`);
      }
      handle = spawned;
    } catch (error) {
      abortOwnerChildAdmissionBeforeSpawn(reservation, error);
      throw error;
    }
    const physicalExit = observeOwnerChildExit(handle);
    let running: ReturnType<typeof runForegroundChild>;
    try {
      hooks.onSpawn?.(req, handle, ctx);
      running = runForegroundChild(handle, ctx, {
        onMessage: hooks.onMessage ? (message) => hooks.onMessage?.(req, message, ctx) : undefined,
        onExit: hooks.onExit ? () => hooks.onExit?.(req, ctx) : undefined,
      });
      commitOwnerChildAdmission(reservation, physicalExit);
    } catch (error) {
      try {
        handle.kill('SIGTERM');
      } catch {
        // Exact physical exit observation below remains authoritative.
      }
      await abortOwnerChildAdmissionAfterSpawn(reservation, error, physicalExit);
      throw error;
    }
    return running;
  };
}
