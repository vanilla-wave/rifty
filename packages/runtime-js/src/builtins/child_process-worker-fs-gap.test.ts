/**
 * #1 (review): the generic worker-backed `child_process.spawn('node', …)` /
 * `fork()` path never wired `RIFTY_REMOTE_FS`, so the spawned worker reads its
 * own EMPTY mirror instead of the parent/owner store (only the owner `.bin`
 * executor wires it — ADR-0150). Reachable only from a realm that has the
 * kernel + node-entry worker URLs (owner/page); the supervised-child realm
 * leaves them unset and keeps the working same-realm fallback. Rather than
 * silently spawn an empty-mirror child (ENOENT / wrong FS), the worker route
 * must fail LOUD until the remote-FS is wired (backlog: generic-spawn-worker-remote-fs).
 */
import { setKernelWorkerUrl } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { resetNodeEntryWorkerUrl, setNodeEntryWorkerUrl } from './node-entry-url.ts';

type Coi = { crossOriginIsolated?: boolean };

afterEach(() => {
  // Restoring COI to falsy neutralises the worker-route gate for sibling tests
  // even though kernelWorkerUrl has no public reset (capabilities gate first).
  (globalThis as Coi).crossOriginIsolated = false;
  resetNodeEntryWorkerUrl();
  resetSyncMirror();
});

describe('generic worker-spawn FS gap (#1, ADR-0150)', () => {
  it('throws NotImplementedError instead of spawning an empty-mirror worker child', () => {
    // Force the worker-route gate true: COI (SAB) + both host worker URLs set —
    // i.e. the owner/page realm where this path was a silent empty-mirror ENOENT.
    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    setNodeEntryWorkerUrl('https://rifty.test/node-entry.js');
    writeFileSync('/script.js', '');
    expect(() => spawn('node', ['/script.js'])).toThrowError(
      expect.objectContaining({ name: 'NotImplementedError' }) as unknown as Error,
    );
  });
});
