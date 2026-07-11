/**
 * Conformance test for ADR-0011 phase 2 follow-up — `ChildProcess.stdin`
 * wired through `WorkerProcessHandle.stdin()` for the SAB-Worker path.
 *
 * The parent calls `child.stdin.write(bytes)` / `child.stdin.end()`; the
 * bytes are routed via the kernel-side `bindPortAsWritable(ports.stdin)`
 * `Writable` into the child realm's stdin `MessagePort`. This transport test
 * reads the raw process-spec port to isolate `child_process`; runtime-js's
 * MessagePort-fed flowing `process.stdin` is covered separately by its parity
 * suite and the public workbench Chromium round-trip (ADR-0230).
 *
 * Skips outside an SAB-capable environment — Vitest's plain Node runner
 * has no `crossOriginIsolated` so `isSabIpcSupported()` is `false`. The
 * suite executes for real in the browser e2e harness once the playground
 * spins up a worker child via `spawn('node', […])`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSabIpcSupported } from '../../../packages/kernel/src/index.ts';
import { spawn } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

const sabReady = isSabIpcSupported();

describe.skipIf(!sabReady)(
  'child_process.spawn — stdin wire-up (ADR-0011 phase 2 follow-up)',
  () => {
    it('parent child.stdin.write+end bytes arrive at the child stdin port and echo on stdout', async () => {
      // The child reads chunks off the kernel-published process spec's
      // stdin port and writes each chunk verbatim to stdout. A 100ms tail
      // lets the parent's writes land before the worker exits.
      writeFileSync(
        '/stdin-echo.js',
        `
const spec = globalThis.__riftyProcessSpec__;
const port = spec.stdio.stdin;
port.onmessage = (ev) => {
  if (ev.data instanceof Uint8Array) {
    globalThis.process.stdout.write(ev.data);
  }
};
port.start();
await new Promise((r) => setTimeout(r, 100));
`,
      );
      const child = spawn('node', ['/stdin-echo.js']);
      let out = '';
      child.stdout.on('data', (c) => {
        out += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
      });
      child.stdin.write(new TextEncoder().encode('hello stdin'));
      child.stdin.end();
      const code = await new Promise<number | null>((resolve) =>
        child.on('close', (c) => resolve(c as number | null)),
      );
      expect(code).toBe(0);
      expect(out).toBe('hello stdin');
    });
  },
);
