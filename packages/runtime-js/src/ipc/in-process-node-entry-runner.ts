/**
 * In-process node-entry runner for `execSync` (Node-conformance seam, ADR-0137).
 *
 * The Node-hosted execSync substitute (`tests/conformance/builtins/
 * child_process.test.ts` injects a `runWorker`; `tools/node-parity-runner`'s
 * `exec-sync` mode) has NO kernel Worker / `kind:'url'` bootstrap, so it cannot
 * use {@link makeRecursiveRunner} (which spawns a `kind:'url'` child). This
 * runner loader-runs the script IN-PROCESS via `runNodeEntry` against
 * `syncMirror()` — so a `#!` shebang is stripped and relative `import`/`require`
 * resolve against the VFS, identical to the browser path (both go through the
 * module loader), without spawning a Worker.
 *
 * Kept in its OWN file (not `recursive-runner.ts`) so the production cold-start
 * graph `child_process → handlers → recursive-runner` does NOT statically pull
 * the module loader (`node-entry.ts` → `module-loader/loader.ts`) — the same
 * madge-cycle care `node-entry-url.ts` documents. Only tests/parity import this.
 */

import { syncMirror } from '../builtins/fs-sync-mirror.ts';
import { runNodeEntry } from '../builtins/node-entry.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from '../builtins/process-bootstrap-identity.ts';
import { riftyProcess } from '../builtins/process.ts';
import { type NodeEntryRunner, concatChunks } from './recursive-runner.ts';

/**
 * Build the in-process runner. Loader-runs the entry via `runNodeEntry`,
 * capturing the child's stdout BYTES.
 *
 * The loader does NOT inject `process` into the module scope — user code reads
 * the AMBIENT global `process`. In a real kernel Worker the pre-entry hook makes
 * `globalThis.process === riftyProcess`; in a Node-hosted substitute the global
 * is real Node's process (its `stdout.write` would escape to the host terminal,
 * uncapturable). So this runner installs `riftyProcess` as `globalThis.process`
 * with a CAPTURING `stdout` for the duration of the run — exactly the Worker's
 * realm shape, scoped — then restores the prior global. The child's
 * `process.stdout.write(...)` bytes are collected verbatim (byte-exact, matching
 * the Worker stdout port); `process.exitCode = N` lands on `riftyProcess` and is
 * honored on a clean return (ADR-0157 D4); a throw → exitCode 1 (Node parity);
 * a `process.exit(N)` shape carries its own code.
 *
 * `riftyProcess.stdout` is a plain settable instance property (process.ts:361),
 * so the stdout swap restores cleanly. A brand-new child starts at exit 0, so
 * the singleton's `exitCode` is reset around the run.
 */
export function makeInProcessNodeEntryRunner(): NodeEntryRunner {
  return async (spec) => {
    const chunks: Uint8Array[] = [];
    const enc = new TextEncoder();
    const capture = {
      write(chunk: unknown): boolean {
        if (chunk instanceof Uint8Array) chunks.push(new Uint8Array(chunk));
        else chunks.push(enc.encode(String(chunk)));
        return true;
      },
      isTTY: false,
      fd: 1,
    };
    const g = globalThis as { process?: unknown };
    const prevGlobalProcess = g.process;
    const prevActiveProcess = readActiveNodeProcessBootstrap();
    const prevStdout = riftyProcess.stdout;
    const prevExitCode = riftyProcess.exitCode;
    (riftyProcess as { stdout: unknown }).stdout = capture;
    riftyProcess.exitCode = 0;
    // Make the loader-run child read `riftyProcess` as the ambient `process`
    // (its stdout/exitCode now route to our capture), the same realm shape the
    // kernel pre-entry hook gives a Worker child — scoped to this run.
    g.process = riftyProcess;
    setActiveNodeProcessBootstrap(riftyProcess);
    let exitCode = 0;
    try {
      await runNodeEntry({
        vfs: syncMirror(),
        entryPath: spec.entryPath,
        cwd: spec.cwd,
        bin: false,
      });
      exitCode = riftyProcess.exitCode;
    } catch (err) {
      exitCode = exitCodeFromThrow(err);
    } finally {
      g.process = prevGlobalProcess;
      setActiveNodeProcessBootstrap(
        prevActiveProcess?.process ?? null,
        prevActiveProcess?.federated ?? false,
      );
      (riftyProcess as { stdout: unknown }).stdout = prevStdout;
      riftyProcess.exitCode = prevExitCode;
    }
    return { stdout: concatChunks(chunks), exitCode };
  };
}

/**
 * `process.exit(N)` inside a loader-run entry throws a RIFTY_PROCESS_EXIT shape
 * (`{ code: 'RIFTY_PROCESS_EXIT', exitCode }`, process.ts:431) carrying its own
 * code; any other throw is a non-zero exit (Node surfaces it via the error's
 * `status`). Mirrors the kernel worker-entry's `isRiftyProcessExit`.
 */
function exitCodeFromThrow(err: unknown): number {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'RIFTY_PROCESS_EXIT' &&
    typeof (err as { exitCode?: unknown }).exitCode === 'number'
  ) {
    return (err as { exitCode: number }).exitCode;
  }
  return 1;
}
