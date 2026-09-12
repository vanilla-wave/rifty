/**
 * F09 — spawn-ceiling contract (Q-2026-05-30-063).
 *
 * Pins the IMPOSSIBLE side of the opencode tool-execution ceiling as a
 * behavioral contract, not prose. Every fundamentally-impossible opencode
 * tool transitively hits `child_process.spawn` of a real binary:
 *   - the git tool   -> `Git.run` -> `ChildProcess.make('git', ...)`
 *   - the bash tool  -> `ChildProcess.make('bash', ['-c', ...])`
 *   - the ripgrep tool -> the ripgrep BINARY
 * In a browser/WASI realm there is no shell and no process spawn, so any
 * command other than `node <script>` falls through `spawnViaSameRealm` ->
 * `execScript` and surfaces `spawn <cmd> ENOENT\n` on stderr with exit 127.
 * It MUST NOT fake-succeed.
 *
 * This is a CONFORMANCE (rifty browser-ceiling) contract, NOT a Node-parity
 * case: real Node WOULD spawn `git`, so a parity diff is the wrong tool here.
 * We assert on `git` / `bash` only — both always fall through, independent of
 * the kernel-worker / SAB capability gate (which only ever routes
 * `node <script>` to the Worker path). We deliberately do NOT assert on a
 * `node`-routed command because its path is env-dependent.
 *
 * opencode is NOT vendored; we test rifty's own spawn boundary, which is the
 * substrate the impossible tools would hit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';

const TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');

afterEach(() => {
  resetSyncMirror();
  Reflect.deleteProperty(globalThis, TOOLCHAIN_REALM);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Drain a child's stderr and resolve with its exit code + the full stderr on
 * close. `stderr` is read from the closure AFTER the `'close'` promise
 * settles, not captured at resolve time: the same-realm fallback emits
 * `'close'` synchronously from `finish()` while the Readable flushes its
 * buffered `'data'` on the following microtask, so capturing inside the
 * `resolve(...)` call would race ahead of the data and read `''`.
 */
async function collect(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; stderr: string }> {
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', (c) => resolve(c as number | null));
  });
  return { code, stderr };
}

describe('spawn ceiling (F09 / Q-2026-05-30-063) — impossible tools are walled off', () => {
  it('adds the no-COI same-realm warning only in a selected toolchain Worker', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await collect(spawn('git', ['status']));
    expect(warn).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, TOOLCHAIN_REALM, { value: true, configurable: true });
    await collect(spawn('git', ['status']));
    await collect(spawn('git', ['status']));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("spawn('git') surfaces ENOENT-127 and never fake-succeeds", async () => {
    const child = spawn('git', ['status']);
    const { code, stderr } = await collect(child);
    // The substrate of opencode's git tool (Git.run -> ChildProcess.make('git')).
    expect(code).toBe(127);
    expect(stderr).toContain('spawn git ENOENT');
    // It must NOT fake-succeed: 0 would be a silent lie about a tool that
    // cannot run in a browser realm.
    expect(code).not.toBe(0);
  });

  it("spawn('bash') surfaces ENOENT-127 and never fake-succeeds", async () => {
    const child = spawn('bash', ['-c', 'echo hi']);
    const { code, stderr } = await collect(child);
    // The substrate of opencode's bash tool — there is no shell.
    expect(code).toBe(127);
    expect(stderr).toContain('spawn bash ENOENT');
    expect(code).not.toBe(0);
  });

  it('keeps node-script stdin a real pipe on the in-realm fallback', async () => {
    writeFileSync(
      '/ceiling-stdin.js',
      "process.stdin.on('data', (chunk) => process.stdout.write(chunk));",
    );
    const child = spawn('node', ['/ceiling-stdin.js']);
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array);
    });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));

    child.stdin.write('x');
    child.stdin.end();

    await closed;
    expect(stdout).toBe('x');
  });
});
