/**
 * Conformance test for ADR-0045 — fork-mode IPC over the kernel-allocated
 * parent↔child `MessagePort` pair on the SAB-Worker path.
 *
 * The parent forks a worker child; the child's `process.on('message', …)`
 * fires for each `child.send(...)` from the parent, and the child's
 * `process.send(...)` surfaces as a `'message'` event on the parent's
 * `ChildProcess`. `disconnect()` on either side closes the channel
 * symmetrically — subsequent sends return `false`.
 *
 * Skips outside an SAB-capable environment — Vitest's plain Node runner
 * has no `crossOriginIsolated` so `isSabIpcSupported()` is `false`. The
 * suite executes for real in the browser e2e harness once the playground
 * spins up a worker child via `fork(...)`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSabIpcSupported } from '../../../packages/kernel/src/index.ts';
import { fork, spawn } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

const sabReady = isSabIpcSupported();

describe.skipIf(!sabReady)('child_process.fork — Worker-backed IPC (ADR-0045)', () => {
  it('parent.send → child receives → child.send → parent receives (round-trip)', async () => {
    // The child installs a `'message'` listener that echoes each
    // incoming payload back wrapped under an `echo` key.
    writeFileSync(
      '/echo-ipc.js',
      `
process.on('message', (msg) => {
  process.send({ echo: msg });
});
// Keep the realm alive long enough for the parent to round-trip.
await new Promise((r) => setTimeout(r, 100));
`,
    );

    const child = fork('/echo-ipc.js');
    const replies: unknown[] = [];
    child.on('message', (m) => replies.push(m));

    // Let the child's module-level `await import(...)` install the
    // message listener before we send anything.
    await new Promise((r) => setTimeout(r, 25));

    expect(child.send({ hi: 1 })).toBe(true);
    expect(child.send('two')).toBe(true);

    // Drain: wait for both replies.
    await new Promise((r) => setTimeout(r, 50));

    expect(replies).toEqual([{ echo: { hi: 1 } }, { echo: 'two' }]);

    await new Promise<void>((resolve) => child.on('close', () => resolve()));
  });

  it("auto-disconnect on natural exit: child.send returns false after, 'disconnect' fires once", async () => {
    writeFileSync(
      '/quick-exit.js',
      `
// Touch process so the runtime fully installs the shim, then return.
void process.pid;
`,
    );

    const child = fork('/quick-exit.js');
    let disconnects = 0;
    child.on('disconnect', () => {
      disconnects++;
    });

    await new Promise<void>((resolve) => child.on('close', () => resolve()));

    // After the worker exits, the kernel auto-tears-down the IPC port
    // and the parent's handle emits `'disconnect'` exactly once.
    expect(disconnects).toBe(1);
    expect(child.send({ late: true })).toBe(false);
  });

  it("explicit child.disconnect(): worker sees 'disconnect', subsequent child.send returns false", async () => {
    // The child writes to stdout when it observes a disconnect, so the
    // parent can verify the event landed inside the worker realm.
    writeFileSync(
      '/observe-disconnect.js',
      `
process.on('disconnect', () => {
  process.stdout.write('child-disconnect\\n');
});
// Keep the realm alive a bit so the parent's disconnect frame can land.
await new Promise((r) => setTimeout(r, 100));
`,
    );

    const child = spawn('node', ['/observe-disconnect.js'], { __fork: true } as never);
    let parentDisconnects = 0;
    child.on('disconnect', () => {
      parentDisconnects++;
    });

    let stdoutText = '';
    child.stdout.on('data', (c) => {
      stdoutText += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });

    // Wait a tick so the worker installs its `'disconnect'` listener.
    await new Promise((r) => setTimeout(r, 25));

    child.disconnect();
    // Subsequent send returns `false`.
    expect(child.send({ x: 1 })).toBe(false);
    // Parent's `'disconnect'` event fires synchronously off the local
    // tear-down.
    expect(parentDisconnects).toBe(1);

    await new Promise<void>((resolve) => child.on('close', () => resolve()));
    expect(stdoutText).toContain('child-disconnect');
  });
});
