import { Readable } from '@riftydev/io';
/**
 * REAL guest-process stdio as the pipe exemption carrier
 * (readable-pipe-never-ends-process-stdio Acceptance 2): the io-layer unit
 * tests exercise the registration seam; THIS test drives the actual
 * spec-seeded NodeProcess stderr writer (makeStdioWriter, fd 2, registered by
 * construction) through Readable.pipe — no hand-built stand-ins.
 */
import { describe, expect, it } from 'vitest';
import { setActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';
import { defineLifecycleIdentity } from './process-lifecycle-dispatcher.ts';
import { NodeProcess } from './process.ts';

/** Minimal transport seam (the external kernel port boundary): the CARRIER
 * under test is the REAL makeStdioWriter, not the transport. */
function fakePort(): unknown {
  return {
    write(): boolean {
      return true;
    },
    postMessage(): void {},
    start(): void {},
    close(): void {},
    addEventListener(): void {},
    removeEventListener(): void {},
  };
}

function specFor(stdio: unknown): ConstructorParameters<typeof NodeProcess>[0] {
  return {
    pid: 4,
    ppid: 1,
    argv: ['rifty', 'x.js'],
    env: {},
    cwd: '/',
    stdio: { stdout: stdio, stderr: stdio, stdin: stdio, ipc: stdio },
  } as unknown as ConstructorParameters<typeof NodeProcess>[0];
}

describe('Readable.pipe into a REAL process stdio writer (Acceptance 2, I4)', () => {
  it('pipe(process.stderr) completes with no dest.end error; the writer stays un-ended', async () => {
    const proc = new NodeProcess(specFor(fakePort()));
    defineLifecycleIdentity(proc);
    setActiveNodeProcessBootstrap(proc);
    expect((proc.stderr as { fd?: number }).fd).toBe(2);

    const src = new Readable({ read() {} });
    src.pipe(proc.stderr as never);
    src.push('to-stderr\n');
    src.push(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    // No `dest.end is not a function` throw and no end call on the writer —
    // the process owns its stdio lifetime (the exemption).
    expect((proc.stderr as { end?: unknown }).end).toBeUndefined();
    setActiveNodeProcessBootstrap(null);
  });
});
