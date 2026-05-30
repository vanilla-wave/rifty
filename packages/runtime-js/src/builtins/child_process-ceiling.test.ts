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
 * `execScript` and surfaces `spawn <cmd> ENOENT\n` on stderr with exit 127
 * (`child_process-exec.ts:54-58`). It MUST NOT fake-succeed.
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
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';

afterEach(() => resetSyncMirror());

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

  it('child.stdin.write throws NotImplementedError on the in-realm fallback', () => {
    // Locks the documented no-shell stdin behavior (child_process.ts:76-89):
    // the in-realm fallback has no worker stdin port, so a write is a loud
    // throw rather than a silent no-op.
    writeFileSync('/ceiling-stdin.js', '');
    const child = spawn('node', ['/ceiling-stdin.js']);
    expect(() => child.stdin.write('x')).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child.stdin.write',
      }) as unknown as Error,
    );
  });
});
