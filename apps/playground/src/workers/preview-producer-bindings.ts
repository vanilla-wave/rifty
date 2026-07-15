import type { CommandContext, ProcessExit } from '@riftydev/shell';
import type { BinExecutorDeps, BinSpawnRequest } from '../glue/bin-executor.ts';
import { isNodeChildMessage } from '../glue/node-child-ipc.ts';
import type { OwnerPtyRunAdmission } from '../glue/pty-protocol.ts';
import { type DevServerController, runDevServerShellCommand } from './dev-server-controller.ts';
import type { NodeRunHooks } from './owner-child-node-executor.ts';
import {
  HOST_PREVIEW_ORIGIN,
  type PreviewProducerOrigin,
  type PreviewRegistry,
} from './preview-registry.ts';
import { binNameOf } from './vite-cli-prep.ts';

export const PTY_SESSION_ENV = 'RIFTY_INTERNAL_PTY_SID';

export type ActivePtyAdmission = (ptySid: string) => OwnerPtyRunAdmission | null;
export type PreviewOriginCapture = () => PreviewProducerOrigin;

/** Bind trusted actor identity outside guest command state; invoke once at child launch. */
export function createPreviewOriginCapture(
  activeAdmission: ActivePtyAdmission,
  ptySid?: string,
): PreviewOriginCapture {
  const capture = (): PreviewProducerOrigin => {
    if (ptySid === undefined) return HOST_PREVIEW_ORIGIN;
    const admission = activeAdmission(ptySid);
    if (admission === null) {
      throw new Error(`Preview producer has no active PTY admission for ${ptySid}`);
    }
    if (admission.ptySid !== ptySid) {
      throw new Error(
        `Preview producer admission mismatch: requested ${ptySid}, received ${admission.ptySid}`,
      );
    }
    return Object.freeze({ kind: 'pty', admission });
  };
  return Object.freeze(capture);
}

export async function runPtyDevServerShellCommand(options: {
  readonly captureOrigin: PreviewOriginCapture;
  readonly controller: DevServerController;
  readonly ctx: CommandContext;
}): Promise<ProcessExit> {
  let origin: PreviewProducerOrigin;
  try {
    origin = options.captureOrigin();
  } catch (error) {
    options.ctx.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { code: 1, signal: null };
  }
  return runDevServerShellCommand(options.controller, options.ctx, origin);
}

interface InstalledBinLaunch {
  readonly sid: string;
  readonly origin: PreviewProducerOrigin;
  readonly cwd: string;
  readonly labelBase: string;
  readonly previewScope?: string;
}

/** Hooks used by the real installed-bin executor; onStart is the capture boundary. */
export function createInstalledBinPreviewHooks(options: {
  readonly captureOrigin: PreviewOriginCapture;
  /** Owner-wide allocator; per-shell counters collide across sibling terminals. */
  readonly allocateSid: () => string;
  readonly previews: PreviewRegistry;
}): Pick<BinExecutorDeps, 'onStart' | 'onMessage' | 'onExit'> {
  const launches = new WeakMap<BinSpawnRequest, InstalledBinLaunch>();
  return {
    onStart(req, ctx) {
      const origin = options.captureOrigin();
      launches.set(req, {
        sid: options.allocateSid(),
        origin,
        cwd: ctx.cwd,
        labelBase: binNameOf(req.shimPath),
        ...(req.env.RIFTY_PREVIEW_SCOPE ? { previewScope: req.env.RIFTY_PREVIEW_SCOPE } : {}),
      });
    },
    onMessage(req, message) {
      if (!isNodeChildMessage(message)) return;
      const launch = launches.get(req);
      if (launch === undefined) return;
      options.previews.addNode(
        launch.sid,
        message.ports,
        message.previewScope ?? launch.previewScope,
        {
          origin: launch.origin,
          cwd: launch.cwd,
          labelBase: launch.labelBase,
        },
      );
    },
    onExit(req) {
      const launch = launches.get(req);
      if (launch === undefined) return;
      launches.delete(req);
      options.previews.removeBySid(launch.sid);
    },
  };
}

/** Hooks used by the real node child executor; construction is the launch boundary. */
export function createNodePreviewRunHooks(options: {
  readonly captureOrigin: PreviewOriginCapture;
  readonly previews: PreviewRegistry;
  readonly cwd: string;
  readonly sid: string;
  readonly previewScope: string;
}): NodeRunHooks {
  const origin = options.captureOrigin();
  return {
    sid: options.sid,
    onListening: (sid, ports, previewScope) =>
      options.previews.addNode(sid, ports, previewScope ?? options.previewScope, {
        origin,
        cwd: options.cwd,
      }),
    onExit: (sid) => options.previews.removeBySid(sid),
  };
}
