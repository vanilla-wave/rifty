import { NotImplementedError } from '@riftydev/io';
import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js';
import {
  type BinExecutor,
  type CommandContext,
  type ProcessExit,
  Shell,
  type ShellCommandResult,
} from '@riftydev/shell';
import { type VfsMutationGuard, isAbsolute, normalizePath } from '@riftydev/vfs';
import type { OwnerToPageFrame, PageToOwnerFrame } from '../glue/pty-protocol.ts';
import { reachableCwd } from '../glue/reachable-cwd.ts';
import { runNestedShellCommand } from '../glue/run-nested-shell-command.ts';
import { createDevServerController } from './dev-server-controller.ts';
import { classifyNodeInvocation, resolveNodeEntry } from './node-entry-resolve.ts';
import { readNodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';
import { createOwnerChildBinExecutor } from './owner-child-bin-executor.ts';
import { createOwnerChildDevServer } from './owner-child-dev-server.ts';
import { createOwnerChildNodeExecutor } from './owner-child-node-executor.ts';
import type { OwnerPackageConfig, OwnerPackageState } from './owner-package-state.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  createInstalledBinPreviewHooks,
  createNodePreviewRunHooks,
  createPreviewOriginCapture,
  runPtyDevServerShellCommand,
} from './preview-producer-bindings.ts';
import { createPreviewRegistry } from './preview-registry.ts';
import { type PtyServer, createPtyServer } from './pty-server.ts';
import { createPreviewScope } from './vite-cli-prep.ts';

export interface WorkbenchProjectRuntimeOptions {
  /** Materializer-owned root. Page claims and project ids are resolved before this seam. */
  readonly projectRoot: string;
  /** Exact config already activated by the lifetime package authority. */
  readonly packageConfig: OwnerPackageConfig;
  readonly authority: OwnerVfsAuthority;
  readonly packageState: OwnerPackageState;
  readonly nodeEntryWorkerUrl: string;
  readonly devServerWorkerUrl: string;
  readonly nodeWorkerRuntimeEnv: Readonly<Record<string, string>>;
  /** Project VFS owns package FIFO, semantic evidence, and reply publication. */
  readonly mutationGuard: VfsMutationGuard;
  /** Owner-applied VFS state must precede every observable PTY completion. */
  readonly publicationBarrier: () => Promise<void>;
  /** Raw project-local PTY frames; lifetime owner wraps tokens outside this module. */
  readonly send: (frame: OwnerToPageFrame) => void;
}

export interface WorkbenchProjectRuntime {
  handlePtyFrame(frame: PageToOwnerFrame): void | Promise<void>;
  /** Fence producers synchronously; settle children, packages, then durability. */
  close(): Promise<void>;
}

interface CloseFailure {
  readonly phase: 'preview-fence' | 'pty' | 'packages' | 'durability';
  readonly error: unknown;
}

const CLOSE_PHASE_ORDER: Readonly<Record<CloseFailure['phase'], number>> = Object.freeze({
  pty: 0,
  'preview-fence': 1,
  packages: 2,
  durability: 3,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertProjectRoot(options: WorkbenchProjectRuntimeOptions): string {
  if (
    typeof options.projectRoot !== 'string' ||
    !isAbsolute(options.projectRoot) ||
    normalizePath(options.projectRoot) !== options.projectRoot
  ) {
    throw new TypeError('Workbench project root must be an absolute normalized owner path');
  }
  if (options.packageConfig.cfg.root !== options.projectRoot) {
    throw new TypeError('Workbench package config root does not match the owner project root');
  }
  if (options.authority.statSyncOrNull(options.projectRoot)?.isDirectory !== true) {
    throw new TypeError(`Workbench owner project root is not a directory: ${options.projectRoot}`);
  }
  return options.projectRoot;
}

function assertCleanFlush(report: Awaited<ReturnType<OwnerVfsAuthority['flush']>>): void {
  if (report === undefined || report.total === 0) return;
  const details = report.failures
    .map((failure) => `${failure.op} ${failure.path}: ${failure.message}`)
    .join('; ');
  throw new Error(
    `${String(report.total)} unhealed persistence failure(s)${details ? `: ${details}` : ''}`,
  );
}

/** One active Workbench project; the lifetime owner retains storage/package authorities. */
export function createWorkbenchProjectRuntime(
  options: WorkbenchProjectRuntimeOptions,
): WorkbenchProjectRuntime {
  const projectRoot = assertProjectRoot(options);
  const previews = createPreviewRegistry({ send: options.send });
  const serverRef: { current?: PtyServer } = {};
  let binSequence = 0;
  let nodeSequence = 0;
  let closePromise: Promise<void> | undefined;

  const ownerNodeExecutor = createOwnerChildNodeExecutor(
    options.nodeEntryWorkerUrl,
    options.nodeWorkerRuntimeEnv,
  );
  const devServer =
    options.packageConfig.cfg.runtime === 'node-server'
      ? (() => {
          const cfg = options.packageConfig.cfg;
          const child = createOwnerChildDevServer(
            options.devServerWorkerUrl,
            readNodeWorkerRuntimeConfig(options.nodeWorkerRuntimeEnv, 'workbench-project-runtime'),
          );
          return createDevServerController({
            lifecycle: previews,
            boot: (ctx, origin) =>
              child.boot({
                signal: ctx.signal,
                log: (chunk) => ctx.stdout.write(chunk),
                params: {
                  cfg,
                  env: { ...ctx.env },
                  previewScope: createPreviewScope(),
                  isTTY: ctx.isTTY === true,
                  cols: ctx.cols ?? 80,
                  rows: ctx.rows ?? 24,
                  terminal: ctx.terminal,
                },
                // Workbench has no page-owned VFS mirror: child writes already
                // land in the sole owner authority and its revision stream.
                onSnapshotDirty: () => {},
                onPortsChanged: (ports, previewScope) => {
                  const next = ports[0];
                  if (next === undefined) previews.clearDevServer();
                  else previews.setDevServer(next, previewScope, { origin, cwd: ctx.cwd });
                },
                flush: () => options.authority.flush(),
              }),
          });
        })()
      : null;

  const activeAdmission = (ptySid: string) => serverRef.current?.activeAdmission(ptySid) ?? null;

  const makeShell = (
    seed: { readonly cwd?: string; readonly env?: Record<string, string> } | undefined,
    ptySid: string,
  ): Shell => {
    const captureOrigin = createPreviewOriginCapture(activeAdmission, ptySid);
    const childBinExecutor = createOwnerChildBinExecutor(
      options.nodeEntryWorkerUrl,
      options.nodeWorkerRuntimeEnv,
      createInstalledBinPreviewHooks({
        captureOrigin,
        allocateSid: () => `workbench-bin-${++binSequence}`,
        previews,
      }),
    );
    const executeInstalledBin: BinExecutor = async (binPath, args, ctx) => {
      await options.packageState.reassertTemplateNodeModules(options.packageConfig);
      return childBinExecutor(binPath, args, ctx);
    };
    const shell = new Shell({
      cwd: reachableCwd(options.authority, seed?.cwd, projectRoot),
      env: { ...(seed?.env ?? {}) },
      execBin: executeInstalledBin,
      mutationGuard: options.mutationGuard,
      assertPortablePaths: (paths) => options.authority.assertPortablePaths(paths),
    });
    const npm = options.packageState.createNpmCommand(async (name, command, ctx) => {
      if (name === 'dev' && devServer !== null) {
        await options.packageState.reassertTemplateNodeModules(options.packageConfig);
        return runPtyDevServerShellCommand({ captureOrigin, controller: devServer, ctx });
      }
      const nested = makeShell({ cwd: ctx.cwd, env: ctx.env }, ptySid);
      return runNestedShellCommand(nested, command, ctx);
    });
    shell.registerCommand('npm', npm);
    const spawnNodeEntry = (
      entryPath: string,
      scriptArgs: readonly string[],
      ctx: CommandContext,
    ): Promise<ProcessExit> => {
      const sid = `workbench-node-${++nodeSequence}`;
      const previewScope = createPreviewScope();
      return ownerNodeExecutor(
        entryPath,
        scriptArgs,
        ctx,
        createNodePreviewRunHooks({
          captureOrigin,
          previews,
          cwd: ctx.cwd,
          sid,
          previewScope,
        }),
      );
    };
    shell.registerCommand('node', async (args, ctx): Promise<ShellCommandResult> => {
      const invocation = classifyNodeInvocation(args);
      switch (invocation.kind) {
        case 'missing': {
          const resolved = resolveNodeEntry(ctx.cwd, undefined);
          if (!resolved.ok) ctx.stderr.write(resolved.message);
          return 1;
        }
        case 'version':
          ctx.stdout.write(`${NODE_PROCESS_IDENTITY.version}\n`);
          return 0;
        case 'badOption':
          ctx.stderr.write(`node: bad option: ${invocation.flag}\n`);
          return 9;
        case 'eval':
          // TODO(backlog: runtime-js/node-cli-eval-identity-parity)
          throw new NotImplementedError('workbench.node.eval-context');
        case 'entry': {
          const resolved = resolveNodeEntry(ctx.cwd, invocation.arg);
          if (!resolved.ok) {
            ctx.stderr.write(resolved.message);
            return 1;
          }
          return spawnNodeEntry(resolved.path, invocation.scriptArgs, ctx);
        }
      }
    });
    return shell;
  };

  const ptyServer = createPtyServer({
    send: options.send,
    makeShell,
    beforeExit: options.publicationBarrier,
    onPreviewReq: () => previews.publish(),
    onDevServerReq: () => previews.publishDev(),
    onDevConfig: () =>
      Promise.reject(new Error('Workbench project config is immutable for the active project')),
  });
  serverRef.current = ptyServer;

  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    const failures: CloseFailure[] = [];

    let ptyClosing: Promise<void>;
    try {
      ptyClosing = ptyServer.close();
    } catch (error) {
      failures.push({ phase: 'pty', error });
      ptyClosing = Promise.resolve();
    }

    try {
      previews.close();
    } catch (error) {
      failures.push({ phase: 'preview-fence', error });
    }

    const finalize = (async () => {
      try {
        await ptyClosing;
      } catch (error) {
        failures.push({ phase: 'pty', error });
      }
      try {
        await options.packageState.quiesce();
      } catch (error) {
        failures.push({ phase: 'packages', error });
      }
      try {
        assertCleanFlush(await options.authority.flush());
      } catch (error) {
        failures.push({ phase: 'durability', error });
      }
      if (failures.length === 0) return;
      const phaseErrors = failures
        .sort((left, right) => CLOSE_PHASE_ORDER[left.phase] - CLOSE_PHASE_ORDER[right.phase])
        .map(
          (failure) =>
            new Error(`${failure.phase}: ${errorMessage(failure.error)}`, { cause: failure.error }),
        );
      throw new AggregateError(
        phaseErrors,
        `Workbench project runtime close failed: ${phaseErrors
          .map((failure) => failure.message)
          .join('; ')}`,
      );
    })();
    void finalize.then(resolveClose, rejectClose);
    return closePromise;
  };

  return Object.freeze({
    handlePtyFrame(frame: PageToOwnerFrame): void | Promise<void> {
      return ptyServer.handleFrame(frame);
    },
    close,
  });
}
