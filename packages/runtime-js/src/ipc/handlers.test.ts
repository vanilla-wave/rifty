/**
 * ADR-0039 — `'execSync'` handler registration lives in runtime-js, not
 * the kernel. After `installRuntimeJsExecSyncHandler(...)` the dispatcher
 * must dispatch `'execSync'` requests through the runtime-js code path:
 *   - reject anything that isn't `node <script>` with `EUNSUPPORTED`.
 *   - reject missing scripts with `ENOENT` (via the resolver returning `null`).
 *   - on a healthy run, return the captured stdout as a UTF-8 string.
 *   - on a child failure, throw an `Error` with `code = 'ECHILDFAILED'`.
 *
 * The tests substitute the recursive runner so no real Worker is spawned —
 * the assertion surface is the handler's wire contract, not the kernel's
 * spawn pipeline (covered by `process-manager.test.ts` and the conformance
 * suite).
 */

import { SyncRpcDispatcher } from '@rifty/kernel';
import { describe, expect, it } from 'vitest';
import { installRuntimeJsExecSyncHandler } from './handlers.ts';
import type { RecursiveRunResult } from './recursive-runner.ts';

/**
 * Install the handler and capture the `'execSync'` callback so tests can
 * exercise it without spinning up a real SAB ring or Worker. Vitest tests
 * don't have a SAB to round-trip through, so wrapping `register` is the
 * simplest way to recover the handler the install helper just installed.
 */
function installAndCapture(
  resolveScript: (path: string) => Uint8Array | null,
  runWorker?: (spec: {
    readonly entry: { readonly kind: 'source'; readonly code: string; readonly sourceUrl: string };
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
  }) => Promise<RecursiveRunResult>,
): (payload: unknown) => unknown | Promise<unknown> {
  const dispatcher = new SyncRpcDispatcher();
  let captured: ((payload: unknown) => unknown | Promise<unknown>) | null = null;
  // Wrap `register` so the test sees what `installRuntimeJsExecSyncHandler`
  // installs without coupling to the dispatcher's internal map.
  const originalRegister = dispatcher.register.bind(dispatcher);
  dispatcher.register = (m: string, h: (p: unknown) => unknown | Promise<unknown>) => {
    if (m === 'execSync') captured = h;
    originalRegister(m, h);
  };
  installRuntimeJsExecSyncHandler(
    dispatcher,
    resolveScript,
    runWorker === undefined
      ? {}
      : {
          // The handler's runWorker is structurally typed; the test's
          // narrower `entry.kind: 'source'` is a valid subtype.
          runWorker: runWorker as never,
        },
  );
  if (captured === null) throw new Error('installAndCapture: execSync handler not registered');
  return captured;
}

describe('installRuntimeJsExecSyncHandler — runtime-js execSync handler (ADR-0039)', () => {
  it('registers an "execSync" method on the dispatcher', () => {
    const handler = installAndCapture(() => new Uint8Array());
    expect(typeof handler).toBe('function');
  });

  it("rejects commands that aren't 'node <script>' with EUNSUPPORTED", async () => {
    const handler = installAndCapture(() => new Uint8Array());
    await expect(handler({ cmd: 'ls -la' })).rejects.toMatchObject({
      code: 'EUNSUPPORTED',
    });
  });

  it('rejects missing scripts with ENOENT', async () => {
    const handler = installAndCapture(() => null);
    await expect(handler({ cmd: 'node /missing.js' })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('runs the recursive runner and returns its stdout as UTF-8', async () => {
    const enc = new TextEncoder();
    const handler = installAndCapture(
      (path) => (path === '/run.js' ? enc.encode('void 0;') : null),
      async (spec) => {
        // Sanity: the handler hands us the resolved source and a sane argv.
        expect(spec.entry).toEqual({
          kind: 'source',
          code: 'void 0;',
          sourceUrl: '/run.js',
        });
        expect(spec.argv).toEqual(['rifty', '/run.js']);
        return { stdout: enc.encode('hello-from-child'), exitCode: 0 };
      },
    );
    const result = await handler({ cmd: 'node /run.js' });
    expect(result).toBe('hello-from-child');
  });

  it('propagates child failure as ECHILDFAILED with the exit code', async () => {
    const enc = new TextEncoder();
    const handler = installAndCapture(
      () => enc.encode('void 0;'),
      async () => ({ stdout: new Uint8Array(), exitCode: 7 }),
    );
    await expect(handler({ cmd: 'node /run.js' })).rejects.toMatchObject({
      code: 'ECHILDFAILED',
      exitCode: 7,
    });
  });

  it('forwards opts.cwd and opts.env into the recursive runner', async () => {
    const enc = new TextEncoder();
    let captured: { cwd?: string; env?: Readonly<Record<string, string>> } = {};
    const handler = installAndCapture(
      () => enc.encode('void 0;'),
      async (spec) => {
        captured = { cwd: spec.cwd, env: spec.env };
        return { stdout: new Uint8Array(), exitCode: 0 };
      },
    );
    await handler({
      cmd: 'node /run.js arg1',
      opts: { cwd: '/srv', env: { FOO: 'bar' } },
    });
    expect(captured.cwd).toBe('/srv');
    expect(captured.env).toEqual({ FOO: 'bar' });
  });

  it('coerces malformed payloads', async () => {
    const handler = installAndCapture(() => null);
    await expect(handler(undefined)).rejects.toThrow(/payload must be an object/);
    await expect(handler({})).rejects.toThrow(/payload.cmd must be a string/);
  });
});
