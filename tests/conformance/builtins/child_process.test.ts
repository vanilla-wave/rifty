import { afterEach, describe, expect, it } from 'vitest';
import {
  SabRing,
  SyncRpcDispatcher,
  createSabRing,
  decodeReply,
  encodeRequest,
} from '../../../packages/kernel/src/index.ts';
import {
  exec,
  execSync,
  fork,
  spawn,
} from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';
import { installRuntimeJsExecSyncHandler } from '../../../packages/runtime-js/src/ipc/handlers.ts';
import { makeInProcessNodeEntryRunner } from '../../../packages/runtime-js/src/ipc/in-process-node-entry-runner.ts';

afterEach(() => resetSyncMirror());

describe('child_process.spawn', () => {
  it('runs a script and streams stdout', async () => {
    writeFileSync('/hello.js', "__stdout_write('hi from child\\n');");
    const child = spawn('node', ['/hello.js']);
    let out = '';
    child.stdout.on('data', (c) => {
      out += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(out).toBe('hi from child\n');
    expect(code).toBe(0);
  });

  it('exit code 1 on thrown error', async () => {
    writeFileSync('/bad.js', "throw new Error('boom');");
    const child = spawn('node', ['/bad.js']);
    let err = '';
    child.stderr.on('data', (c) => {
      err += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(code).toBe(1);
    expect(err).toContain('boom');
  });

  it('spawn with unknown command emits ENOENT-like stderr + exit 127', async () => {
    const child = spawn('not-a-command');
    let err = '';
    child.stderr.on('data', (c) => {
      err += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(code).toBe(127);
    expect(err).toMatch(/ENOENT/);
  });
});

describe('child_process.exec', () => {
  it('buffers stdout/stderr into callback', async () => {
    writeFileSync('/say.js', "__stdout_write('ok');");
    await new Promise<void>((resolve, reject) => {
      exec('node /say.js', (err, stdout, stderr) => {
        if (err) reject(err);
        try {
          expect(stdout).toBe('ok');
          expect(stderr).toBe('');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});

describe('child_process.fork', () => {
  it('returns a ChildProcess (IPC API present)', () => {
    writeFileSync('/c.js', "__stdout_write('forked');");
    const child = fork('/c.js');
    expect(typeof child.send).toBe('function');
    expect(typeof child.kill).toBe('function');
  });
});

describe('child_process.execSync', () => {
  // Post 2026-05-27 audit item #2: the in-realm `new Function(...)` fallback
  // was a silent stub (no exit code, no stdio isolation, no PID) and violated
  // CLAUDE.md "no silent stubs". Outside a SAB-capable kernel Worker the
  // function now throws `NotImplementedError`; the SAB happy path is exercised
  // separately in `exec-sync-worker.test.ts` (gated on `crossOriginIsolated`
  // + `getKernelWorkerUrl()`).
  it('throws NotImplementedError when SAB IPC is unavailable', () => {
    writeFileSync('/sync.js', "__stdout_write('sync');");
    expect(() => execSync('node /sync.js')).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.execSync',
      }) as unknown as Error,
    );
  });
});

describe('execSync — v2 binary frame returns byte-exact stdout (ADR-0084 #23)', () => {
  // Drives the REAL SAB path in-process: a real SabRing, the real
  // SyncRpcDispatcher, the real runtime-js `'execSync'` handler, and the real
  // v2 binary-frame encodeRequest/decodeReply. The runner is substituted so no
  // Worker spawns, but the child stdout BYTES travel verbatim through the
  // framing — proving non-UTF-8 stdout is NOT mangled to U+FFFD.
  async function roundTrip(stdout: Uint8Array): Promise<Uint8Array> {
    const { sab, ring } = createSabRing({ payloadCapacity: 1024 });
    const caller = SabRing.attach(sab, 1024);
    const dispatcher = new SyncRpcDispatcher();
    installRuntimeJsExecSyncHandler(dispatcher, () => new TextEncoder().encode('void 0;'), {
      runWorker: async () => ({ stdout, exitCode: 0 }),
    });
    dispatcher.attach(ring);
    caller.writeRequest(
      encodeRequest({
        method: 'execSync',
        payload: { cmd: 'node /bin.js', opts: { cwd: '/workspace', env: {} } },
      }),
    );
    // The handler is async (awaits the runner); the backstop/pump writes the
    // reply on a microtask — `waitReplyAsync` parks until the notify fires.
    const replyBytes = await caller.waitReplyAsync(2000);
    dispatcher.detachAll();
    const reply = decodeReply(replyBytes);
    if (!reply.ok) throw new Error(`unexpected error reply: ${JSON.stringify(reply.error)}`);
    return reply.value as Uint8Array;
  }

  it('returns Uint8Array.from([0xff,0xfe,0x00]) byte-exact (length 3, not 7)', async () => {
    const value = await roundTrip(Uint8Array.from([0xff, 0xfe, 0x00]));
    expect(value).toBeInstanceOf(Uint8Array);
    // Pre-fix: the non-fatal TextDecoder mangled these to U+FFFD, inflating to
    // [0xef,0xbf,0xbd,0xef,0xbf,0xbd,0x00] (length 7). The fix keeps them raw.
    expect(value.length).toBe(3);
    expect(Array.from(value)).toEqual([0xff, 0xfe, 0x00]);
  });

  it('round-trips a longer non-UTF-8 byte sequence verbatim', async () => {
    const raw = Uint8Array.from([0x00, 0xc0, 0xc1, 0xf5, 0xff, 0x80, 0x7f, 0x41]);
    const value = await roundTrip(raw);
    expect(Array.from(value)).toEqual(Array.from(raw));
  });

  it('can wire the real handler to the in-process node-entry runner', async () => {
    writeFileSync('/bin.js', "process.stdout.write('loader-ok');\n");
    const { sab, ring } = createSabRing({ payloadCapacity: 1024 });
    const caller = SabRing.attach(sab, 1024);
    const dispatcher = new SyncRpcDispatcher();
    installRuntimeJsExecSyncHandler(
      dispatcher,
      (path) => (path === '/bin.js' ? new Uint8Array(0) : null),
      { runWorker: makeInProcessNodeEntryRunner() },
    );
    dispatcher.attach(ring);
    caller.writeRequest(
      encodeRequest({
        method: 'execSync',
        payload: { cmd: 'node /bin.js', opts: { cwd: '/', env: {} } },
      }),
    );

    const replyBytes = await caller.waitReplyAsync(2000);
    dispatcher.detachAll();
    const reply = decodeReply(replyBytes);

    if (!reply.ok) throw new Error(`unexpected error reply: ${JSON.stringify(reply.error)}`);
    expect(new TextDecoder().decode(reply.value as Uint8Array)).toBe('loader-ok');
  });
});
