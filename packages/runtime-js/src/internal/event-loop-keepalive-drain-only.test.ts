/**
 * A process with no control port (in-process hosts: isolate guest, no-COI
 * command) ends only through its drain: an eval terminal claimed before the
 * host opens that drain must settle it, not park it behind a port exit.
 * Real NodeProcess, real eval entry, real drain.
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { runNodeEntry } from '../builtins/node-entry.ts';
import { setActiveNodeProcessBootstrap } from '../builtins/process-bootstrap-identity.ts';
import { NodeProcess } from '../builtins/process.ts';
import { awaitDrain, handleRealmUncaughtError, resetKeepalive } from './event-loop-keepalive.ts';

const originalProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
afterEach(() => {
  resetKeepalive();
  setActiveNodeProcessBootstrap(null);
  if (originalProcess !== undefined) Object.defineProperty(globalThis, 'process', originalProcess);
});

/** The no-spec process an in-process host runs: no kernel stdio, no control port. */
function portlessProcess(stderr: string[]): NodeProcess {
  const process = new NodeProcess();
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    stderr.push(String(chunk));
    return true;
  };
  Object.defineProperty(globalThis, 'process', {
    value: process,
    configurable: true,
    writable: true,
  });
  setActiveNodeProcessBootstrap(process);
  return process;
}

const evalEntry = (source: string) =>
  runNodeEntry({
    kind: 'eval',
    vfs: new MemoryFsSync(),
    cwd: '/work',
    source,
    print: false,
    explicitCommonJs: false,
  });

describe('eval terminal before the drain of a port-less process', () => {
  it('an exit() after the eval returned and before its drain settles that drain with its code', async () => {
    const stderr: string[] = [];
    const process = portlessProcess(stderr);
    // The host opens its drain after the entry settles, as the isolate guest and no-COI do;
    // a microtask the eval queued runs in between (corpus `exit-in-*` rows run that guest code).
    const drain = evalEntry('1').then(() => {
      expect(() => process.exit(3)).toThrow(expect.objectContaining({ exitCode: 3 }));
      return awaitDrain({ capMs: 1000 });
    });
    await expect(drain).rejects.toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 3 });
    expect(stderr.join('')).toBe('');
  });

  it('an uncaught error claimed before the drain rejects that drain with its projection', async () => {
    portlessProcess([]);
    const drain = evalEntry('1').then(() => {
      expect(handleRealmUncaughtError(new Error('qm'))).toBe(true);
      return awaitDrain({ capMs: 1000 });
    });
    await expect(drain).rejects.toThrow('qm');
  });
});
