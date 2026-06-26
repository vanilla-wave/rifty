/**
 * Owner-realm child `BinExecutor` (ADR-0150: foreground CLIs run in a supervised
 * child worker reading the owner fs over sync-RPC; owner stays a free async
 * supervisor). Each resolved `.bin`/node
 * CLI runs in a supervised child worker-process that reads+writes the owner
 * store over `fs.*` sync-RPC (RIFTY_REMOTE_FS=1). The child is serve-capable:
 * run-to-completion CLIs still exit through node-entry lifecycle, while CLIs
 * that listen() stay alive and post their ports like `node <file>`.
 * The owner stays responsive (blocking work left its thread — ADR-0150
 * invariant). Stream/kill/exit reuse `glue/bin-executor.ts`'s createBinExecutor.
 */

import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import type { BinExecutor } from '@riftydev/shell';
import {
  type BinExecutorDeps,
  type BinSpawnRequest,
  type BinWorkerHandle,
  createBinExecutor,
} from '../glue/bin-executor.ts';

/** Pure: build the spawn spec for a resolved bin request (unit-tested). */
export function buildChildSpawnSpec(req: BinSpawnRequest, nodeEntryUrl: string): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: nodeEntryUrl },
    argv: ['rifty', req.shimPath, ...req.args],
    env: { ...req.env, RIFTY_BIN: '1', RIFTY_REMOTE_FS: '1', RIFTY_NODE_SERVE: '1' },
    cwd: req.cwd,
    serve: true,
  };
}

/** Build the owner's child-spawning BinExecutor. `nodeEntryUrl` = node-entry bootstrap worker URL. */
export function createOwnerChildBinExecutor(
  nodeEntryUrl: string,
  hooks: Pick<BinExecutorDeps, 'onStart' | 'onSpawn' | 'onMessage' | 'onExit'> = {},
): BinExecutor {
  return createBinExecutor({
    ...hooks,
    spawn: (req): BinWorkerHandle => {
      const handle = globalProcessManager.spawnWorker(
        req.shimPath,
        buildChildSpawnSpec(req, nodeEntryUrl),
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
  });
}
