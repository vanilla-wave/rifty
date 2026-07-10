/**
 * Inner script-execution helper for `child_process.spawn`. Split out of
 * `child_process.ts` to keep that file under the ADR-0024 line budget.
 *
 * Owns the actual `new Function(...)` eval, the `__process` proxy passed to
 * the script (argv/env/stdout/stderr/optional IPC), and the exit-code
 * translation that the kernel `ProcessManager` needs (ENOENT-127,
 * `process.exit(N)`) — see `child_process.ts` for the outer wrapper.
 */

import { Buffer, type EventEmitter, NotImplementedError } from '@riftydev/io';
import { type ProcessHandle, type ProcessIO, globalProcessManager } from '@riftydev/kernel';
import { resolveNodeEntryPath } from '../internal/node-entry-path.ts';
import { serializeNodeIpcMessage } from '../internal/node-ipc-serialization.ts';
import { syncMirror } from './fs-sync-mirror.ts';

export interface ExecScriptArgs {
  command: string;
  args: string[];
  opts: { cwd?: string; env?: Record<string, string>; __fork?: boolean };
  io: ProcessIO;
  ownHandle: ProcessHandle;
  inboundIpc: EventEmitter;
  stdoutPush: (chunk: unknown) => void;
  stderrPush: (chunk: unknown) => void;
  /** Bus shared with the outer ChildProcess wrapper so `__process.send`
   * can surface `'message'` events on it. */
  outboundMessages: EventEmitter;
}

/**
 * Run a child script through `new Function`. Mutates `ownHandle.exitCode`
 * directly for non-zero exits (so the kernel preserves them) and emits
 * `'exit'` / `'close'` on the handle itself.
 */
export async function execScript(a: ExecScriptArgs): Promise<void> {
  const writeStdout = (chunk: string): void => {
    a.io.write('stdout', chunk);
    a.stdoutPush(chunk);
  };
  const writeStderr = (chunk: string): void => {
    a.io.write('stderr', chunk);
    a.stderrPush(chunk);
  };
  const closeStreams = (): void => {
    a.stdoutPush(null);
    a.stderrPush(null);
  };
  const finish = (exitCode: number): void => {
    if (a.ownHandle.exitCode !== null) return;
    a.ownHandle.exitCode = exitCode;
    a.ownHandle.emit('exit', exitCode, null);
    a.ownHandle.emit('close', exitCode, null);
  };

  if (a.command === 'ps' && a.args.length === 0) {
    // Default `ps` selects processes associated with this terminal. The
    // virtual ProcessManager does not track controlling terminals, so the
    // truthful default selection is empty; do not invent TTY or CPU-time data.
    writeStdout(' PID TTY          TIME CMD\n');
    closeStreams();
    return;
  }

  const isPpidPidTable =
    a.command === 'ps' &&
    a.args.length === 3 &&
    a.args[0] === '-A' &&
    a.args[1] === '-o' &&
    a.args[2] === 'ppid,pid';
  if (isPpidPidTable) {
    const rows = globalProcessManager
      .list()
      .map((handle) => `${String(handle.ppid).padStart(5)} ${String(handle.pid).padStart(5)}`);
    writeStdout(` PPID   PID\n${rows.length > 0 ? `${rows.join('\n')}\n` : ''}`);
    closeStreams();
    return;
  }

  if (a.command === 'ps') {
    const error = new NotImplementedError(
      'child_process.ps-format',
      "supported forms are bare 'ps' and 'ps -A -o ppid,pid'",
    );
    writeStderr(`${error.name}: ${error.message}\n`);
    closeStreams();
    finish(1);
    return;
  }

  if (a.command !== 'node') {
    writeStderr(`spawn ${a.command} ENOENT\n`);
    closeStreams();
    finish(127);
    return;
  }
  const entryArg = a.args[0];
  if (!entryArg) {
    writeStderr('node: missing script\n');
    closeStreams();
    finish(1);
    return;
  }
  const scriptPath = resolveNodeEntryPath(a.ownHandle.cwd, entryArg);

  try {
    const source = syncMirror().readFileBytesSync(scriptPath);
    const code = Buffer.from(source).toString();
    const fn = new Function(
      '__stdout_write',
      '__stderr_write',
      '__process',
      `${code}\n//# sourceURL=${scriptPath}`,
    ) as (
      write: (chunk: string) => void,
      ewrite: (chunk: string) => void,
      proc: unknown,
    ) => unknown;
    const childProcess: {
      argv: string[];
      env: Record<string, string>;
      stdout: { write(c: string): void };
      stderr: { write(c: string): void };
      send?: (msg: unknown) => boolean;
      on?: (event: string, cb: (msg: unknown) => void) => void;
      onMessage?: (cb: (msg: unknown) => void) => () => void;
      exit?: (code: number) => never;
    } = {
      argv: ['rifty', scriptPath, ...a.args.slice(1)],
      env: a.opts.env ?? {},
      stdout: { write: writeStdout },
      stderr: { write: writeStderr },
    };
    if (a.opts.__fork) {
      childProcess.send = (msg) => {
        a.outboundMessages.emit('message', serializeNodeIpcMessage(msg));
        return true;
      };
      const onMessage = (cb: (msg: unknown) => void) => {
        const wrapped = (m: unknown) => cb(m);
        a.inboundIpc.on('childMessage', wrapped);
        return () => a.inboundIpc.off('childMessage', wrapped);
      };
      childProcess.onMessage = onMessage;
      childProcess.on = (event, cb) => {
        if (event === 'message') onMessage(cb);
      };
      childProcess.exit = (exitCode) => {
        closeStreams();
        finish(exitCode);
        throw Object.assign(new Error('__process.exit'), { code: 'RIFTY_PROCESS_EXIT' });
      };
    }
    const result = fn(writeStdout, writeStderr, childProcess);
    await Promise.resolve(result);
    closeStreams();
  } catch (err) {
    const isProcessExit =
      err && typeof err === 'object' && (err as { code?: string }).code === 'RIFTY_PROCESS_EXIT';
    if (isProcessExit) return;
    writeStderr(err instanceof Error ? `${err.stack ?? err.message}\n` : String(err));
    closeStreams();
    finish(1);
  }
}
