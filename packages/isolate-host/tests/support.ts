import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodeCliEvalRawOutcome } from '../../../tools/node-parity-runner/src/node-cli-eval.ts';

/** The live oracle: `node -e <code>` by this very Node executable, empty env, fresh cwd. */
export function nodeEval(code: string): NodeCliEvalRawOutcome {
  const cwd = mkdtempSync(join(tmpdir(), 'isolate-host-oracle-'));
  try {
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd,
      env: {},
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { stdout: r.stdout, stderr: r.stderr, frames: [], code: r.status, signal: r.signal };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Direct children of `pid` (POSIX `ps`), without the `ps` probe itself. */
export function childPids(pid = process.pid): number[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const pids: number[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && Number(m[2]) === pid && !(m[3] ?? '').startsWith('ps ')) pids.push(Number(m[1]));
  }
  return pids;
}

/** The only child of this process, once there is exactly one. */
export function soleChild(): number | undefined {
  const pids = childPids();
  return pids.length === 1 ? pids[0] : undefined;
}

/** The environment block of a live process: Linux `/proc/<pid>/environ`, macOS `ps eww`. */
export function processEnvironment(pid: number): string {
  if (process.platform === 'linux') return readFileSync(`/proc/${pid}/environ`, 'utf8');
  return execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
}

export function processCommand(pid: number): string {
  return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
}

export async function waitFor<T>(probe: () => T | undefined, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: nothing within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Resident set size of a live process in KiB (`ps -o rss=`), or null once it is gone. */
export function rssKb(pid: number): number | null {
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return out === '' ? null : Number(out);
  } catch {
    return null;
  }
}

const DIST_INDEX = new URL('../dist/index.js', import.meta.url).href;

/**
 * Run `body` (an async function body) in a fresh consumer process importing the
 * built package at `entry`; return what it `out()`s (one JSON value). In scope:
 * `runCode`, `children()` (this consumer's child pids), `kill(pid)`,
 * `sleep(ms)`, `now()`, `waitFor(probe, ms)`, `settle(promise)` (a rejection →
 * `{rejected: message, code}`), `sampleChildren()` (`.stop()` → peak child count).
 * The consumer ends by `process.exit` after the body unless `naturalExit`.
 */
export async function consumer(
  body: string,
  { entry = DIST_INDEX, naturalExit = false, timeoutMs = 60_000 } = {},
): Promise<{ value: unknown; exitCode: number | null; signal: string | null; ms: number }> {
  const script = `import { execFileSync } from 'node:child_process';
    import { readFileSync } from 'node:fs';
    const { runCode } = await import(${JSON.stringify(entry)});
    const children = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
      .split('\\n').map((l) => /^\\s*(\\d+)\\s+(\\d+)\\s+(.*)$/.exec(l))
      // Workers only: a just-forked \`ps\` still shows its parent's command line until it execs.
      .filter((m) => m && Number(m[2]) === process.pid && m[3].includes('child.js')).map((m) => Number(m[1]));
    const kill = (pid) => process.kill(pid, 'SIGKILL');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const now = () => performance.now();
    const waitFor = async (probe, ms) => {
      const end = Date.now() + ms;
      for (;;) { const v = probe(); if (v !== undefined) return v; if (Date.now() > end) throw new Error('waitFor: nothing within ' + ms + ' ms'); await sleep(20); }
    };
    const settle = (p) => p.then((r) => r, (e) => ({ rejected: String(e && e.message), code: e && e.code }));
    const sampleChildren = () => { let max = children().length; const t = setInterval(() => { max = Math.max(max, children().length); }, 20); return { stop: () => { clearInterval(t); return Math.max(max, children().length); } }; };
    const out = (v) => process.stdout.write('\\n' + JSON.stringify({ value: v }) + '\\n');
    try { await (async () => { ${body} })(); }
    catch (e) { out({ harnessError: String(e && e.stack || e) }); }
    ${naturalExit ? '' : 'process.exit(0);'}`;
  const started = Date.now();
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    stdout += d;
  });
  const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const [exitCode, signal] = (await once(child, 'exit')) as [number | null, string | null];
  clearTimeout(killer);
  const line = stdout.trim().split('\n').at(-1) ?? '';
  let value: unknown = { unparsed: stdout };
  try {
    value = (JSON.parse(line) as { value: unknown }).value;
  } catch {}
  return { value, exitCode, signal, ms: Date.now() - started };
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
