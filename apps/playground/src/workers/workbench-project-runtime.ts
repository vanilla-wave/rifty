import { type BinExecutor, type CommandContext, Shell } from '@riftydev/shell';
import { type VfsMutationGuard, isAbsolute, normalizePath } from '@riftydev/vfs';
import type { OwnerToPageFrame, PageToOwnerFrame } from '../glue/pty-protocol.ts';
import { reachableCwd } from '../glue/reachable-cwd.ts';
import { runNestedShellCommand } from '../glue/run-nested-shell-command.ts';
import { createOwnerChildBinExecutor } from './owner-child-bin-executor.ts';
import type { OwnerPackageConfig, OwnerPackageState } from './owner-package-state.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  PTY_SESSION_ENV,
  createInstalledBinPreviewHooks,
  createPreviewOriginCapture,
} from './preview-producer-bindings.ts';
import { createPreviewRegistry } from './preview-registry.ts';
import { type PtyServer, createPtyServer } from './pty-server.ts';
import { withViteCliEnv } from './vite-cli-prep.ts';

export interface WorkbenchProjectRuntimeOptions {
  /** Materializer-owned root. Page claims and project ids are resolved before this seam. */
  readonly projectRoot: string;
  /** Exact config already activated by the lifetime package authority. */
  readonly packageConfig: OwnerPackageConfig;
  readonly authority: OwnerVfsAuthority;
  readonly packageState: OwnerPackageState;
  readonly nodeEntryWorkerUrl: string;
  readonly nodeWorkerRuntimeEnv: Readonly<Record<string, string>>;
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
  if (options.packageConfig.cfg.runtime !== 'vite') {
    throw new TypeError('Workbench project runtime requires a Vite package config');
  }
  if (options.packageConfig.cfg.root !== options.projectRoot) {
    throw new TypeError('Workbench package config root does not match the owner project root');
  }
  if (options.authority.statSyncOrNull(options.projectRoot)?.isDirectory !== true) {
    throw new TypeError(`Workbench owner project root is not a directory: ${options.projectRoot}`);
  }
  return options.projectRoot;
}

function cleanGuestEnv(seed: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(seed ?? {}).filter(([key]) => key !== PTY_SESSION_ENV));
}

function cleanViteControlEnv(ctx: CommandContext): CommandContext {
  const env = Object.fromEntries(
    Object.entries(ctx.env).filter(
      ([key]) => key !== 'RIFTY_PREVIEW_SCOPE' && key !== 'RIFTY_VITE_CLI_MODE',
    ),
  );
  return { ...ctx, env };
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
  let closePromise: Promise<void> | undefined;

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
      return childBinExecutor(
        binPath,
        args,
        withViteCliEnv(binPath, args, cleanViteControlEnv(ctx)),
      );
    };
    const shell = new Shell({
      cwd: reachableCwd(options.authority, seed?.cwd, projectRoot),
      env: cleanGuestEnv(seed?.env),
      execBin: executeInstalledBin,
      mutationGuard: ((intents, apply) =>
        options.packageState.mutations.guardedMutation(intents, async () =>
          apply(),
        )) satisfies VfsMutationGuard,
      assertPortablePaths: (paths) => options.authority.assertPortablePaths(paths),
    });
    const npm = options.packageState.createNpmCommand(async (_name, command, ctx) => {
      const nested = makeShell({ cwd: ctx.cwd, env: ctx.env }, ptySid);
      return runNestedShellCommand(nested, command, ctx);
    });
    shell.registerCommand('npm', npm);
    return shell;
  };

  const ptyServer = createPtyServer({
    send: options.send,
    makeShell,
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
