/** Process/network helpers shared by the lane drivers. */
import { type ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') {
        srv.close();
        reject(new Error('agent-bench: could not allocate a free port'));
        return;
      }
      const { port } = address;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runToCompletion(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `agent-bench: \`${cmd} ${args.join(' ')}\` timed out after ${opts.timeoutMs}ms\n${stderr.slice(-2000)}`,
        ),
      );
    }, opts.timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function runOrThrow(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<RunResult> {
  const result = await runToCompletion(cmd, args, opts);
  if (result.code !== 0) {
    throw new Error(
      `agent-bench: \`${cmd} ${args.join(' ')}\` exited ${result.code}\nstdout: ${result.stdout.slice(-2000)}\nstderr: ${result.stderr.slice(-2000)}`,
    );
  }
  return result;
}

/** Is anything answering HTTP here right now? (single attempt, short timeout) */
export async function isHttpUp(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function waitHttpReady(url: string, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`agent-bench: ${what} not ready at ${url} after ${timeoutMs}ms (${lastError})`);
}

export function tailOf(path: string, bytes: number): string {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > bytes ? text.slice(-bytes) : text;
  } catch {
    return `(no output captured at ${path})`;
  }
}

export function spawnLoggedServer(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; logPath: string; detached?: boolean },
): ChildProcess {
  writeFileSync(opts.logPath, `$ ${cmd} ${args.join(' ')}\n`, 'utf8');
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // detached → own process group, so killProcessGroup reaps grandchildren
    // (pnpm run wrappers would otherwise orphan the actual server).
    detached: opts.detached ?? false,
  });
  const append = (d: Buffer): void => appendFileSync(opts.logPath, d.toString(), 'utf8');
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return child;
}

/** Kill a `detached` child's whole process group (falls back to the child). */
export function killProcessGroup(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const signal = (sig: NodeJS.Signals): void => {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, sig);
        return;
      } catch {
        // group already gone or not detached — fall through to the child itself
      }
    }
    child.kill(sig);
  };
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    signal('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) signal('SIGKILL');
    }, 2000).unref();
  });
}

export function killChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2000).unref();
  });
}
