import { NotImplementedError } from '@riftydev/io';
import { listPorts } from '@riftydev/net';
import { type SerializedRuntimeError, awaitDrain } from '@riftydev/runtime-js';
import { type RunNodeEntryOptions, runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import {
  resetNodeProcessExit,
  riftyProcess,
  setProcessCwd,
} from '@riftydev/runtime-js/builtins/process';
import {
  type ToolchainCommandInput,
  type ToolchainCommandResult,
  activeRefs,
  captureNodeProcessGlobals,
  installConsole,
  isNodeProcessExiting,
  takeUnhandledRejection,
  terminateFatal,
} from '@riftydev/runtime-js/internal';
import { type CommandContext, Shell, ShellCommandLifecycleError } from '@riftydev/shell';
import type { FsSync } from '@riftydev/vfs';
import { createNpmScriptShellCommand } from '../glue/npm-shell-command.ts';
import { runNestedShellCommand } from '../glue/run-nested-shell-command.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { declaredGapCause } from './declared-gap-cause.ts';
import { type NoCoiInvocationScope, openNoCoiInvocationScope } from './no-coi-invocation-scope.ts';
import { classifyNodeInvocation, resolveNodeEntry } from './node-entry-resolve.ts';

interface CommandHooks {
  readonly fs: FsSync;
  onOutput(chunk: string, stream: 'stdout' | 'stderr'): void;
  flush(): Promise<'memory' | 'flushed'>;
  effects(): 'no' | 'yes' | 'unknown';
  install?(args: readonly string[], context: CommandContext): Promise<number>;
}

function processExitCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; exitCode?: unknown };
  return candidate.code === 'RIFTY_PROCESS_EXIT' && typeof candidate.exitCode === 'number'
    ? candidate.exitCode
    : null;
}

/**
 * ADR-0445: the drain settled with the process's terminal, Node's status. Its
 * timers die with it; any other live handle (port, pending import/fetch)
 * outlives it in this reused realm, so the realm is replaced instead.
 */
function terminalExitCode(settlement: unknown, invocation: NoCoiInvocationScope): number | null {
  const exitCode = processExitCode(settlement);
  if (exitCode === null || declaredGapCause(settlement) !== null) return null;
  invocation.clearTimers();
  if (activeRefs() > 0 || listPorts().length > 0) return null;
  takeUnhandledRejection();
  return exitCode;
}

function serializeError(error: unknown): SerializedRuntimeError {
  const cause = declaredGapCause(error) ?? error;
  if (!(cause instanceof Error)) return { name: 'Error', message: String(cause) };
  const detail = cause as Error & { code?: unknown; feature?: unknown; path?: unknown };
  return {
    name: cause.name,
    message: cause.message,
    ...(cause.stack === undefined ? {} : { stack: cause.stack }),
    ...(typeof detail.code === 'string' ? { code: detail.code } : {}),
    ...(typeof detail.feature === 'string' ? { feature: detail.feature } : {}),
    ...(typeof detail.path === 'string' ? { path: detail.path } : {}),
  };
}

/** One invocation owns the existing Shell, Node handler, event loop and checked persistence. */
export async function runNoCoiProjectCommand(
  input: ToolchainCommandInput,
  signal: AbortSignal,
  hooks: CommandHooks,
): Promise<ToolchainCommandResult> {
  let requiresTermination = false;
  let failed = false;
  let failure: unknown;
  let registryFailure: unknown;
  const install = hooks.install;
  const allowed =
    input.project.allowedCommands === undefined
      ? undefined
      : new Set(input.project.allowedCommands);

  const runInPlace = async (
    entry: RunNodeEntryOptions,
    argv: readonly string[],
    execArgv: readonly string[],
    ctx: CommandContext,
  ): Promise<number> => {
    const invocation = openNoCoiInvocationScope();
    const previous = {
      cwd: riftyProcess.cwd(),
      env: riftyProcess.env,
      argv: riftyProcess.argv,
      execArgv: riftyProcess.execArgv,
      exitCode: riftyProcess.exitCode,
      stdout: riftyProcess.stdout.write,
      stderr: riftyProcess.stderr.write,
    };
    const restoreConsole = installConsole({
      stdout: (chunk) => ctx.stdout.write(chunk),
      stderr: (chunk) => ctx.stderr.write(chunk),
    });
    riftyProcess.stdout.write = (chunk) => {
      ctx.stdout.write(chunk);
      return true;
    };
    const writeStderr = (chunk: string | Uint8Array): boolean => {
      ctx.stderr.write(chunk);
      return true;
    };
    riftyProcess.stderr.write = writeStderr;
    riftyProcess.env = { ...ctx.env };
    riftyProcess.argv = [...argv];
    riftyProcess.execArgv = [...execArgv];
    // ADR-0445: each invocation starts with an unset exitCode, not exiting.
    resetNodeProcessExit(riftyProcess);
    setProcessCwd(ctx.cwd);
    let executionError: unknown;
    let executionFailed = false;
    const abort = () => {
      try {
        riftyProcess.emit('SIGINT');
      } catch (error) {
        executionFailed = true;
        executionError = error;
      }
    };
    ctx.signal?.addEventListener('abort', abort, { once: true });
    try {
      try {
        await runNodeEntry(entry);
      } catch (error) {
        executionFailed = true;
        // ADR-0445 (2026-11-18): Node prints a no-listener entry/eval throw and
        // exits inside TriggerUncaughtException. The runtime fatal terminal
        // prints it now, to the invocation's stderr as Node writes fd 2 (not a
        // guest-patched `process.stderr.write`); none of its timers runs after.
        const fatal = processExitCode(error) === null && isNodeProcessExiting(riftyProcess);
        if (fatal) Reflect.set(riftyProcess.stderr, 'write', writeStderr);
        executionError = fatal ? (terminateFatal(error) ?? error) : error;
        if (processExitCode(executionError) !== null) invocation.clearTimers();
      }
      // The drain settles with the terminal, else runs the entry's scheduled work.
      let terminal: number | null = null;
      try {
        await awaitDrain({ capMs: 600_000, hasRef: () => listPorts().length > 0 });
      } catch (error) {
        terminal = terminalExitCode(error, invocation);
        if (terminal === null) {
          requiresTermination = true;
          failure = error;
          throw new ShellCommandLifecycleError('Node event-loop settlement failed', {
            cause: error,
          });
        }
      }
      if (terminal !== null) return terminal;
      if (executionFailed) {
        const exitCode = processExitCode(executionError);
        if (exitCode !== null) return exitCode;
        throw (
          declaredGapCause(executionError) ??
          (executionError instanceof Error ? executionError : new Error(String(executionError)))
        );
      }
      // Natural exit = Node's `exit()`: `'exit'` once, status `exitCode ?? 0`.
      let naturalExit: unknown;
      try {
        riftyProcess.exit();
      } catch (error) {
        naturalExit = error;
      }
      const exitCode = processExitCode(naturalExit);
      if (exitCode === null) throw naturalExit;
      return exitCode;
    } finally {
      ctx.signal?.removeEventListener('abort', abort);
      // A rejected drain leaves the realm owned until the host physically terminates it.
      if (!requiresTermination) {
        invocation.end();
        restoreConsole();
        riftyProcess.stdout.write = previous.stdout;
        riftyProcess.stderr.write = previous.stderr;
        riftyProcess.env = previous.env;
        riftyProcess.argv = previous.argv;
        riftyProcess.execArgv = previous.execArgv;
        resetNodeProcessExit(riftyProcess);
        riftyProcess.exitCode = previous.exitCode;
        setProcessCwd(previous.cwd);
      }
    }
  };

  // Node: a process sees no global `require`, and its `-e`/`-p` bindings die
  // with it; a guest value under one survives (ADR-0418 correction 2026-11-18).
  const executeNode = async (
    entry: RunNodeEntryOptions,
    argv: readonly string[],
    execArgv: readonly string[],
    ctx: CommandContext,
  ): Promise<number> => {
    const restoreGlobals = captureNodeProcessGlobals(entry.kind === 'eval');
    const settled = await runInPlace(entry, argv, execArgv, ctx).then(
      (exitCode) => ({ ok: true as const, exitCode }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const unrestored = requiresTermination ? null : restoreGlobals();
    if (unrestored !== null) {
      // A guest made it non-configurable: only a new realm returns it.
      requiresTermination = true;
      failure = new Error(
        `node left globalThis.${unrestored} unrestorable in the reused realm; the Worker is replaced`,
      );
      throw new ShellCommandLifecycleError('Node process globals not restored', { cause: failure });
    }
    if (!settled.ok) throw settled.error;
    return settled.exitCode;
  };

  const makeShell = (cwd: string, env: Record<string, string>): Shell => {
    const shell = new Shell({
      cwd,
      env,
      fileSystem: hooks.fs,
      allowBackground: false,
      assertCommand(name) {
        // Only executed commands replace provenance; skipped branches retain it.
        registryFailure = undefined;
        if (allowed !== undefined && !allowed.has(name)) {
          throw Object.assign(new Error(`Command is prohibited: ${name}`), { code: 'EACCES' });
        }
      },
      execBin: (entryPath, args, ctx) =>
        executeNode(
          {
            vfs: hooks.fs,
            entryPath,
            cwd: ctx.cwd,
            bin: entryPath.includes('/node_modules/.bin/'),
          },
          ['node', entryPath, ...args],
          [],
          ctx,
        ),
    });
    shell.registerCommand(
      'npm',
      createNpmScriptShellCommand(
        {
          vfs: new SyncMirrorVfs(),
          runScript: (_name, command, ctx) =>
            runNestedShellCommand(makeShell(ctx.cwd, ctx.env), command, ctx),
        },
        install === undefined
          ? undefined
          : async (args, context) => {
              try {
                return await install(args, context);
              } catch (error) {
                if ((error as { name?: unknown } | null)?.name === 'SandboxRegistryMissingError')
                  registryFailure = error;
                throw error;
              }
            },
      ),
    );
    shell.registerCommand('node', async (args, ctx) => {
      const invocation = classifyNodeInvocation(args);
      switch (invocation.kind) {
        case 'missing':
          ctx.stderr.write('node: missing entry file\nUsage: node <file> [args]\n');
          return 1;
        case 'version':
          ctx.stdout.write(`${riftyProcess.version}\n`);
          return 0;
        case 'usageError':
          ctx.stderr.write(invocation.message);
          return 9;
        case 'badOption':
          ctx.stderr.write(`node: bad option: ${invocation.flag}\n`);
          return 9;
        case 'evalModulePrintError':
          ctx.stderr.write(
            'Error [ERR_EVAL_ESM_CANNOT_PRINT]: --print cannot be used with ESM input\n',
          );
          return 1;
        case 'evalModule':
          throw new NotImplementedError('workbench.node.eval-module-context');
        case 'evalTypeScript':
          throw new NotImplementedError('runtime-js.node-eval-typescript-context');
        case 'preloadContext':
          throw new NotImplementedError('workbench.node.preload-context');
        case 'printProgram':
          throw new NotImplementedError('workbench.node.print-program-context');
        case 'eval':
          return executeNode(
            {
              kind: 'eval',
              vfs: hooks.fs,
              cwd: ctx.cwd,
              source: invocation.source,
              print: invocation.print,
              explicitCommonJs: invocation.execArgv.includes('--input-type=commonjs'),
            },
            ['node', ...invocation.scriptArgs],
            invocation.execArgv,
            ctx,
          );
        case 'entry': {
          const entry = resolveNodeEntry(ctx.cwd, invocation.arg);
          if (!entry.ok) {
            ctx.stderr.write(entry.message);
            return 1;
          }
          return executeNode(
            { vfs: hooks.fs, entryPath: entry.path, cwd: ctx.cwd },
            ['node', entry.path, ...invocation.scriptArgs],
            [],
            ctx,
          );
        }
      }
    });
    return shell;
  };

  const shell = makeShell(input.cwd, { ...input.env });
  let exitCode: number | null = null;
  try {
    const result = await shell.run(input.command, {
      signal,
      onChunk: hooks.onOutput,
      awaitAbortSettlement: true,
    });
    exitCode = result.exitCode;
    if (exitCode !== 0 && registryFailure !== undefined) {
      failed = true;
      failure = registryFailure;
    }
  } catch (error) {
    failed = true;
    failure ??= error;
  } finally {
    await shell.dispose();
  }
  if (requiresTermination) {
    return {
      status: signal.aborted ? 'cancelled' : 'failed',
      exitCode: null,
      effects: { applied: 'unknown', persistence: 'unknown' },
      error: serializeError(failure),
      requiresTermination: true,
    };
  }
  let persistence: ToolchainCommandResult['effects']['persistence'];
  try {
    persistence = await hooks.flush();
  } catch (error) {
    persistence = 'failed';
    failed = true;
    failure = error;
  }
  return {
    status: failed ? 'failed' : signal.aborted ? 'cancelled' : 'exited',
    exitCode,
    effects: { applied: hooks.effects(), persistence },
    ...(failed ? { error: serializeError(failure) } : {}),
  };
}
