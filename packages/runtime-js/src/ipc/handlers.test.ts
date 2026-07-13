/**
 * ADR-0039 — `'execSync'` handler registration lives in runtime-js, not
 * the kernel. After `installRuntimeJsExecSyncHandler(...)` the dispatcher
 * must dispatch `'execSync'` requests through the runtime-js code path:
 *   - reject anything that isn't `node <script>` with `EUNSUPPORTED`.
 *   - reject missing scripts with `ENOENT` (via the resolver returning `null`).
 *   - on a healthy run, return the captured stdout as raw bytes (ADR-0084 #23 —
 *     a `Uint8Array`, byte-exact; the old UTF-8-string contract mangled
 *     non-UTF-8 stdout to U+FFFD).
 *   - on a child failure, throw an `Error` with `code = 'ECHILDFAILED'`.
 *
 * The tests substitute the recursive runner so no real Worker is spawned —
 * the assertion surface is the handler's wire contract, not the kernel's
 * spawn pipeline (covered by `process-manager.test.ts` and the conformance
 * suite).
 */

import { SyncRpcDispatcher } from '@riftydev/kernel';
import { describe, expect, it } from 'vitest';
import { installRuntimeJsExecSyncHandler } from './handlers.ts';
import type { NodeEntryRunner } from './recursive-runner.ts';

/**
 * Install the handler and capture the `'execSync'` callback so tests can
 * exercise it without spinning up a real SAB ring or Worker. Vitest tests
 * don't have a SAB to round-trip through, so wrapping `register` is the
 * simplest way to recover the handler the install helper just installed.
 */
function installAndCapture(
  resolveScript: (path: string) => Uint8Array | null,
  runWorker?: NodeEntryRunner,
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
    runWorker === undefined ? {} : { runWorker },
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
    await expect(
      handler({ cmd: 'ls -la', opts: { cwd: '/workspace', env: {} } }),
    ).rejects.toMatchObject({
      code: 'EUNSUPPORTED',
    });
  });

  it('rejects missing scripts with ENOENT', async () => {
    const handler = installAndCapture(() => null);
    await expect(
      handler({ cmd: 'node /missing.js', opts: { cwd: '/workspace', env: {} } }),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('hands the runner the script PATH (not the bytes) + argv, returns stdout bytes (ADR-0137 / ADR-0084 #23)', async () => {
    // ADR-0137 contract: the handler PASSES THE PATH — the runner re-reads the
    // source through the module loader (shebang strip + relative resolve), so
    // the handler must NOT embed `{kind:'source', code}` bytes. ADR-0084 #23:
    // the returned stdout is a raw Uint8Array (byte-exact on a v2 binary frame).
    // The shebang/relative + byte-exact behaviors are proven independently by
    // `in-process-node-entry-runner.test.ts`, the conformance suite, and the
    // `binary-stdout-exec` hex parity case.
    const enc = new TextEncoder();
    const handler = installAndCapture(
      // The resolver is an ENOENT pre-check only — any non-null sentinel passes;
      // its bytes are discarded (the runner reads the real source).
      (path) => (path === '/run.js' ? new Uint8Array() : null),
      async (spec) => {
        // The handler hands us the resolved PATH and a sane argv — NOT the
        // source code (no `entry`/`code`/`sourceUrl` field exists on the spec).
        expect(spec.entryPath).toBe('/run.js');
        expect(spec.argv).toEqual(['rifty', '/run.js']);
        expect(spec).not.toHaveProperty('entry');
        return { stdout: enc.encode('hello-from-child'), exitCode: 0 };
      },
    );
    const result = await handler({
      cmd: 'node /run.js',
      opts: { cwd: '/workspace', env: {} },
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('hello-from-child');
  });

  it('propagates child failure as ECHILDFAILED with the exit code', async () => {
    const enc = new TextEncoder();
    const handler = installAndCapture(
      () => enc.encode('void 0;'),
      async () => ({ stdout: new Uint8Array(), exitCode: 7 }),
    );
    await expect(
      handler({ cmd: 'node /run.js', opts: { cwd: '/workspace', env: {} } }),
    ).rejects.toMatchObject({
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

  it.each([
    ['missing opts', { cmd: 'node /run.js' }, /payload\.opts must be an object/],
    ['null opts', { cmd: 'node /run.js', opts: null }, /payload\.opts must be an object/],
    [
      'missing cwd',
      { cmd: 'node /run.js', opts: { env: {} } },
      /payload\.opts\.cwd must be a string/,
    ],
    [
      'malformed cwd',
      { cmd: 'node /run.js', opts: { cwd: 42, env: {} } },
      /payload\.opts\.cwd must be a string/,
    ],
    [
      'missing env',
      { cmd: 'node /run.js', opts: { cwd: '/workspace' } },
      /payload\.opts\.env must be a string record/,
    ],
    [
      'array env',
      { cmd: 'node /run.js', opts: { cwd: '/workspace', env: [] } },
      /payload\.opts\.env must be a string record/,
    ],
    [
      'non-string env value',
      { cmd: 'node /run.js', opts: { cwd: '/workspace', env: { PORT: 5173 } } },
      /payload\.opts\.env must be a string record/,
    ],
  ])('rejects %s instead of inventing child process context', async (_label, payload, error) => {
    const handler = installAndCapture(() => new Uint8Array());
    await expect(handler(payload)).rejects.toThrow(error);
  });
});
