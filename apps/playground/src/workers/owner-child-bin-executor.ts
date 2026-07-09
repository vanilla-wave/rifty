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
import type { RecursiveWorkerUrls } from './owner-child-dev-server.ts';

/** Pure: build the spawn spec for a resolved bin request (unit-tested). */
export function buildChildSpawnSpec(
  req: BinSpawnRequest,
  nodeEntryUrl: string,
  workerUrls: RecursiveWorkerUrls = {},
): SpawnWorkerSpec {
  const isTTY = req.isTTY ? '1' : '0';
  return {
    entry: { kind: 'url', url: nodeEntryUrl },
    argv: ['rifty', req.shimPath, ...req.args],
    env: {
      ...req.env,
      RIFTY_BIN: '1',
      RIFTY_REMOTE_FS: '1',
      RIFTY_NODE_SERVE: '1',
      RIFTY_STDIN_IS_TTY: '0',
      RIFTY_STDOUT_IS_TTY: isTTY,
      RIFTY_STDERR_IS_TTY: isTTY,
      // rifty has no native bindings by construction: force Rolldown's napi-rs
      // loader onto its `@rolldown/binding-wasm32-wasi` path and make a failed
      // load LOUD (else it is swallowed as a generic "Cannot find native
      // binding"). Mirrors owner-child-dev-server.ts.
      NAPI_RS_FORCE_WASI: '1',
      // Forward the recursive worker URLs so a foreground `.bin/vite@8` child can
      // spawn Rolldown's WASI pthread pool via kernel.spawnWorker — else the pool
      // falls back to same-realm and the dev server hangs past readiness (backlog
      // playground/vite8-cli-nested-worker-boot). Vite 7 (esbuild, no dev pthread
      // pool) never spawns them, so this is inert for the default path.
      ...(workerUrls.kernelWorkerUrl
        ? { RIFTY_KERNEL_WORKER_URL: workerUrls.kernelWorkerUrl }
        : {}),
      ...(workerUrls.nodeEntryWorkerUrl
        ? { RIFTY_NODE_ENTRY_WORKER_URL: workerUrls.nodeEntryWorkerUrl }
        : {}),
    },
    cwd: req.cwd,
    serve: true,
  };
}

/** Build the owner's child-spawning BinExecutor. `nodeEntryUrl` = node-entry bootstrap worker URL. */
export function createOwnerChildBinExecutor(
  nodeEntryUrl: string,
  hooks: Pick<BinExecutorDeps, 'onStart' | 'onSpawn' | 'onMessage' | 'onExit'> = {},
  workerUrls: RecursiveWorkerUrls = {},
): BinExecutor {
  return createBinExecutor({
    ...hooks,
    spawn: (req): BinWorkerHandle => {
      const handle = globalProcessManager.spawnWorker(
        req.shimPath,
        buildChildSpawnSpec(req, nodeEntryUrl, workerUrls),
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
