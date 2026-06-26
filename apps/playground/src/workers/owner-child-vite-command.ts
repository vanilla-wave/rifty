import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import type { CommandContext } from '@riftydev/shell';
import { type DevServerChildMessage, isDevServerChildMessage } from '../glue/dev-server-ipc.ts';
import { type ForegroundChildHandle, runForegroundChild } from '../glue/run-foreground-child.ts';
import type { RecursiveWorkerUrls } from './owner-child-dev-server.ts';

export type ViteChildMode = 'build' | 'preview';

export interface ViteCommandChildParams {
  readonly templateId: string;
  readonly slug: string;
  readonly setup: 'instant' | 'from-scratch';
  readonly root: string;
  readonly port: number;
}

export function buildViteCommandChildSpawnSpec(
  mode: ViteChildMode,
  params: ViteCommandChildParams,
  childWorkerUrl: string,
  workerUrls: RecursiveWorkerUrls = {},
): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: childWorkerUrl },
    argv: ['rifty', `vite-${mode}`],
    env: {
      RIFTY_REMOTE_FS: '1',
      RIFTY_VITE_CHILD_MODE: mode,
      RIFTY_RFV_TEMPLATE: params.templateId,
      RIFTY_RFV_SLUG: params.slug,
      RIFTY_RFV_SETUP: params.setup,
      RIFTY_RFV_ROOT: params.root,
      RIFTY_DEV_PORT: String(params.port),
      PORT: String(params.port),
      ...(workerUrls.kernelWorkerUrl
        ? { RIFTY_KERNEL_WORKER_URL: workerUrls.kernelWorkerUrl }
        : {}),
      ...(workerUrls.nodeEntryWorkerUrl
        ? { RIFTY_NODE_ENTRY_WORKER_URL: workerUrls.nodeEntryWorkerUrl }
        : {}),
    },
    cwd: params.root,
    serve: mode === 'preview',
  };
}

export interface OwnerChildViteCommand {
  build(params: ViteCommandChildParams, ctx: CommandContext): Promise<number>;
  preview(
    params: ViteCommandChildParams,
    ctx: CommandContext,
    hooks: {
      readonly onReady: (port: number) => void;
      readonly onExit: () => void;
    },
  ): Promise<number>;
}

export function createOwnerChildViteCommand(
  childWorkerUrl: string,
  workerUrls: RecursiveWorkerUrls,
  spawn: (spec: SpawnWorkerSpec) => ForegroundChildHandle = (spec) => {
    const h = globalProcessManager.spawnWorker('vite-command', spec, 1);
    if (h.kind !== 'worker') {
      throw new Error(`owner-child-vite-command: expected worker, got ${h.kind}`);
    }
    return h;
  },
): OwnerChildViteCommand {
  return {
    async build(params, ctx) {
      const handle = spawn(
        buildViteCommandChildSpawnSpec('build', params, childWorkerUrl, workerUrls),
      );
      return runForegroundChild(handle, ctx);
    },
    async preview(params, ctx, hooks) {
      const handle = spawn(
        buildViteCommandChildSpawnSpec('preview', params, childWorkerUrl, workerUrls),
      );
      return runForegroundChild(handle, ctx, {
        onMessage: (message) => {
          if (!isDevServerChildMessage(message)) return;
          const m: DevServerChildMessage = message;
          if (m.type === 'rifty:preview-ready') hooks.onReady(m.port);
        },
        onExit: hooks.onExit,
      });
    },
  };
}
