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

/** Contract seam: trusted actor identity is supplied outside guest command state. */
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

/** Capture once at child launch; the env sid locates actor state but never labels output. */
export function capturePreviewOrigin(
  activeAdmission: ActivePtyAdmission,
  ctx: Pick<CommandContext, 'env'>,
): PreviewProducerOrigin {
  const ptySid = ctx.env[PTY_SESSION_ENV];
  if (ptySid === undefined || ptySid.length === 0) return HOST_PREVIEW_ORIGIN;
  const admission = activeAdmission(ptySid);
  if (admission === null) {
    throw new Error(`Preview producer has no active PTY admission for ${ptySid}`);
  }
  if (admission.ptySid !== ptySid) {
    throw new Error(
      `Preview producer admission mismatch: requested ${ptySid}, received ${admission.ptySid}`,
    );
  }
  return { kind: 'pty', admission };
}

export async function runPtyDevServerShellCommand(options: {
  readonly activeAdmission?: ActivePtyAdmission;
  readonly captureOrigin?: PreviewOriginCapture;
  readonly controller: DevServerController;
  readonly ctx: CommandContext;
}): Promise<ProcessExit> {
  let origin: PreviewProducerOrigin;
  try {
    origin =
      options.captureOrigin?.() ??
      capturePreviewOrigin(options.activeAdmission ?? (() => null), options.ctx);
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
  readonly activeAdmission?: ActivePtyAdmission;
  readonly captureOrigin?: PreviewOriginCapture;
  readonly allocateSid?: () => string;
  readonly previews: PreviewRegistry;
}): Pick<BinExecutorDeps, 'onStart' | 'onMessage' | 'onExit'> {
  let sequence = 0;
  const launches = new WeakMap<BinSpawnRequest, InstalledBinLaunch>();
  return {
    onStart(req, ctx) {
      const origin =
        options.captureOrigin?.() ??
        capturePreviewOrigin(options.activeAdmission ?? (() => null), ctx);
      launches.set(req, {
        sid: options.allocateSid?.() ?? `bin-${++sequence}`,
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
  readonly activeAdmission?: ActivePtyAdmission;
  readonly captureOrigin?: PreviewOriginCapture;
  readonly previews: PreviewRegistry;
  readonly ctx?: CommandContext;
  readonly cwd?: string;
  readonly sid: string;
  readonly previewScope: string;
}): NodeRunHooks {
  const origin =
    options.captureOrigin?.() ??
    capturePreviewOrigin(options.activeAdmission ?? (() => null), options.ctx ?? { env: {} });
  const cwd = options.cwd ?? options.ctx?.cwd ?? '/';
  return {
    sid: options.sid,
    onListening: (sid, ports, previewScope) =>
      options.previews.addNode(sid, ports, previewScope ?? options.previewScope, {
        origin,
        cwd,
      }),
    onExit: (sid) => options.previews.removeBySid(sid),
  };
}
