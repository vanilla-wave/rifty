import { NotImplementedError, captureEventEmitterListenerScope } from '@riftydev/io';
import { listPorts } from '@riftydev/net';
import { type SerializedRuntimeError, awaitDrain } from '@riftydev/runtime-js';
import { type RunNodeEntryOptions, runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { riftyProcess, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import {
  type ToolchainCommandInput,
  type ToolchainCommandResult,
  captureTimerBoundary,
  clearTimersSince,
  installConsole,
} from '@riftydev/runtime-js/internal';
import { type CommandContext, Shell, ShellCommandLifecycleError } from '@riftydev/shell';
import type { FsSync } from '@riftydev/vfs';
import { createNpmScriptShellCommand } from '../glue/npm-shell-command.ts';
import { runNestedShellCommand } from '../glue/run-nested-shell-command.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { declaredGapCause } from './declared-gap-cause.ts';
import { classifyNodeInvocation, resolveNodeEntry } from './node-entry-resolve.ts';

interface CommandHooks {
  readonly fs: FsSync;
  onOutput(chunk: string, stream: 'stdout' | 'stderr'): void;
  flush(): Promise<'memory' | 'flushed'>;
  effects(): 'no' | 'yes' | 'unknown';
}

function processExitCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; exitCode?: unknown };
  return candidate.code === 'RIFTY_PROCESS_EXIT' && typeof candidate.exitCode === 'number'
    ? candidate.exitCode
    : null;
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
  const allowed =
    input.project.allowedCommands === undefined
      ? undefined
      : new Set(input.project.allowedCommands);

  const executeNode = async (
    entry: RunNodeEntryOptions,
    argv: readonly string[],
    execArgv: readonly string[],
    ctx: CommandContext,
  ): Promise<number> => {
    const timerBoundary = captureTimerBoundary();
    const listenerScopes = [
      riftyProcess,
      riftyProcess.stdin,
      riftyProcess.stdout,
      riftyProcess.stderr,
    ].map(captureEventEmitterListenerScope);
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
    riftyProcess.stderr.write = (chunk) => {
      ctx.stderr.write(chunk);
      return true;
    };
    riftyProcess.env = { ...ctx.env };
    riftyProcess.argv = [...argv];
    riftyProcess.execArgv = [...execArgv];
    riftyProcess.exitCode = 0;
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
        executionError = error;
      }
      // A throwing entry may already have scheduled real work. Never skip its drain.
      try {
        await awaitDrain({ capMs: 600_000, hasRef: () => listPorts().length > 0 });
      } catch (error) {
        requiresTermination = true;
        failure = error;
        throw new ShellCommandLifecycleError('Node event-loop settlement failed', { cause: error });
      }
      if (executionFailed) {
        const exitCode = processExitCode(executionError);
        if (exitCode !== null) return exitCode;
        throw (
          declaredGapCause(executionError) ??
          (executionError instanceof Error ? executionError : new Error(String(executionError)))
        );
      }
      return riftyProcess.exitCode;
    } finally {
      ctx.signal?.removeEventListener('abort', abort);
      // A rejected drain leaves the realm owned until the host physically terminates it.
      if (!requiresTermination) {
        for (const retire of listenerScopes) retire();
        clearTimersSince(timerBoundary);
        restoreConsole();
        riftyProcess.stdout.write = previous.stdout;
        riftyProcess.stderr.write = previous.stderr;
        riftyProcess.env = previous.env;
        riftyProcess.argv = previous.argv;
        riftyProcess.execArgv = previous.execArgv;
        riftyProcess.exitCode = previous.exitCode;
        setProcessCwd(previous.cwd);
      }
    }
  };

  const makeShell = (cwd: string, env: Record<string, string>): Shell => {
    const shell = new Shell({
      cwd,
      env,
      fileSystem: hooks.fs,
      allowBackground: false,
      assertCommand(name) {
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
      createNpmScriptShellCommand({
        vfs: new SyncMirrorVfs(),
        runScript: (_name, command, ctx) =>
          runNestedShellCommand(makeShell(ctx.cwd, ctx.env), command, ctx),
      }),
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
