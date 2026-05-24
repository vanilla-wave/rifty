/**
 * Kernel `ProcessRecord.cwd` (ADR-0019) — children inherit a parent snapshot
 * at spawn time; subsequent `chdir` in either does not propagate.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CWD, ProcessManager } from '../src/process-manager.ts';

describe('ProcessManager — cwd inheritance (ADR-0019)', () => {
  it('root spawn defaults cwd to DEFAULT_CWD', async () => {
    const pm = new ProcessManager();
    const child = pm.spawn('test-child', async () => {
      /* noop */
    });
    expect(child.cwd).toBe(DEFAULT_CWD);
  });

  it('explicit options.cwd wins over the default', async () => {
    const pm = new ProcessManager();
    const child = pm.spawn(
      'test-child',
      async () => {
        /* noop */
      },
      1,
      { cwd: '/var/log' },
    );
    expect(child.cwd).toBe('/var/log');
  });

  it('setCwd mutates the record visible through the handle', async () => {
    const pm = new ProcessManager();
    const child = pm.spawn('test-child', async () => {
      /* noop */
    });
    child.setCwd('/srv');
    expect(child.cwd).toBe('/srv');
  });

  it('child spawned with a parent snapshots the parent cwd; later parent chdir does not propagate', async () => {
    const pm = new ProcessManager();
    const parent = pm.spawn(
      'parent',
      async () => {
        /* noop */
      },
      1,
      { cwd: '/a' },
    );
    const child = pm.spawn(
      'child',
      async () => {
        /* noop */
      },
      parent.pid,
    );
    expect(child.cwd).toBe('/a');
    parent.setCwd('/b');
    expect(child.cwd).toBe('/a');
    expect(parent.cwd).toBe('/b');
  });
});
