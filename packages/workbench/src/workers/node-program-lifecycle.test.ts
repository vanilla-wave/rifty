import { describe, expect, it, vi } from 'vitest';
import {
  type NodeLifecycleDeps,
  normalizeExitCode,
  runNodeProgramLifecycle,
} from './node-program-lifecycle.ts';

/** Fake net registry: a mutable port set + change events (onRegistryChange shape). */
function fakeRegistry(initial: number[] = []) {
  const ports = new Set<number>(initial);
  const listeners = new Set<() => void>();
  return {
    listPorts: () => [...ports].sort((a, b) => a - b),
    onPortsChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    listen(port: number) {
      ports.add(port);
      for (const cb of [...listeners]) cb();
    },
    close(port: number) {
      ports.delete(port);
      for (const cb of [...listeners]) cb();
    },
  };
}

function deps(over: Partial<NodeLifecycleDeps> = {}, reg = fakeRegistry()) {
  const d: NodeLifecycleDeps = {
    runEntry: vi.fn(async () => {}),
    listPorts: reg.listPorts,
    onPortsChange: reg.onPortsChange,
    awaitDrain: vi.fn(async () => {}),
    releaseDrainOwnership: vi.fn(),
    servePreview: vi.fn(() => () => {}),
    postListening: vi.fn(),
    readExitCode: vi.fn(() => 0),
    exit: vi.fn(),
    ...over,
  };
  return { d, reg };
}

async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('runNodeProgramLifecycle', () => {
  it('script (no listen): drains then exits 0', async () => {
    const { d } = deps();
    await runNodeProgramLifecycle(d);
    expect(d.runEntry).toHaveBeenCalledOnce();
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.postListening).not.toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('server (listened): serves each port, posts ports, does NOT exit/drain', async () => {
    const { d } = deps({}, fakeRegistry([3000, 8080]));
    await runNodeProgramLifecycle(d);
    expect(d.servePreview).toHaveBeenCalledTimes(2);
    expect(d.servePreview).toHaveBeenCalledWith(3000);
    expect(d.servePreview).toHaveBeenCalledWith(8080);
    expect(d.postListening).toHaveBeenCalledWith([3000, 8080]);
    expect(d.awaitDrain).not.toHaveBeenCalled();
    expect(d.releaseDrainOwnership).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('server whose entry stays pending after listen still posts ports', async () => {
    const { d } = deps(
      { runEntry: vi.fn(() => new Promise<void>(() => {})) },
      fakeRegistry([5174]),
    );
    await runNodeProgramLifecycle(d);
    expect(d.servePreview).toHaveBeenCalledWith(5174);
    expect(d.postListening).toHaveBeenCalledWith([5174]);
    expect(d.awaitDrain).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('pending entry without a port waits on events instead of exiting', async () => {
    const reg = fakeRegistry();
    const { d } = deps({ runEntry: vi.fn(() => new Promise<void>(() => {})) }, reg);
    let settled = false;
    const run = runNodeProgramLifecycle(d).then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false); // parked, not exited
    expect(d.exit).not.toHaveBeenCalled();
    reg.listen(4000); // a LATE listen event wakes the loop → server branch
    await run;
    expect(settled).toBe(true);
    expect(d.servePreview).toHaveBeenCalledWith(4000);
    expect(d.postListening).toHaveBeenCalledWith([4000]);
  });

  it('releases a pending drain before serving and publishing a later port', async () => {
    const reg = fakeRegistry();
    const events: string[] = [];
    const { d } = deps(
      {
        awaitDrain: vi.fn(() => {
          events.push('drain');
          return new Promise<void>(() => {});
        }),
        releaseDrainOwnership: vi.fn(() => {
          events.push('release');
        }),
        servePreview: vi.fn((port) => {
          events.push(`serve:${String(port)}`);
          return () => {};
        }),
        postListening: vi.fn((ports) => {
          events.push(`post:${ports.join(',')}`);
        }),
      },
      reg,
    );
    const run = runNodeProgramLifecycle(d);
    await settle();
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    events.push('port');
    reg.listen(5174);
    await run;
    const release = events.indexOf('release');
    expect(d.releaseDrainOwnership).toHaveBeenCalledOnce();
    expect(release).toBeGreaterThan(events.indexOf('drain'));
    expect(release).toBeGreaterThan(events.indexOf('port'));
    expect(release).toBeLessThan(events.indexOf('serve:5174'));
    expect(release).toBeLessThan(events.indexOf('post:5174'));
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('after served: close() reposts [] and tears the preview; re-listen re-serves', async () => {
    const reg = fakeRegistry([3000]);
    const teardown = vi.fn();
    const { d } = deps(
      {
        runEntry: vi.fn(() => new Promise<void>(() => {})),
        servePreview: vi.fn(() => teardown),
      },
      reg,
    );
    await runNodeProgramLifecycle(d);
    expect(d.postListening).toHaveBeenLastCalledWith([3000]);
    reg.close(3000);
    expect(teardown).toHaveBeenCalledOnce();
    expect(d.postListening).toHaveBeenLastCalledWith([]);
    reg.listen(3001);
    expect(d.servePreview).toHaveBeenCalledWith(3001);
    expect(d.postListening).toHaveBeenLastCalledWith([3001]);
  });

  it('entry process.exit code propagates (drain + preview skipped)', async () => {
    const err = Object.assign(new Error('x'), { code: 'RIFTY_PROCESS_EXIT', exitCode: 3 });
    const { d } = deps({
      runEntry: vi.fn(async () => {
        throw err;
      }),
    });
    await runNodeProgramLifecycle(d);
    expect(d.exit).toHaveBeenCalledWith(3);
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.awaitDrain).not.toHaveBeenCalled();
  });

  it('a non-exit throw propagates (surfaced by kernel worker-entry)', async () => {
    const { d } = deps({
      runEntry: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(runNodeProgramLifecycle(d)).rejects.toThrow('boom');
    expect(d.exit).not.toHaveBeenCalled();
  });

  // D3 (ADR-0157 review): a server that listen()s THEN throws must NOT post a
  // preview slot — the throw short-circuits before listPorts/servePreview, so the
  // owner never adds (and never has to clean up) a slot for a realm that died.
  it('a listen()-then-throw never serves a preview or posts ports', async () => {
    const { d } = deps(
      {
        runEntry: vi.fn(async () => {
          throw new Error('late'); // …after it DID listen (port pre-registered)
        }),
      },
      fakeRegistry([3000]),
    );
    await expect(runNodeProgramLifecycle(d)).rejects.toThrow('late');
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.postListening).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  // D4 (ADR-0157 review): natural exit honours process.exitCode (Node parity).
  it('natural exit exits with process.exitCode, not a hardcoded 0', async () => {
    const { d } = deps({ readExitCode: vi.fn(() => 7) });
    await runNodeProgramLifecycle(d);
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    expect(d.exit).toHaveBeenCalledWith(7);
  });

  it('a listened server ignores process.exitCode (stays alive, no exit)', async () => {
    const { d } = deps({ readExitCode: vi.fn(() => 7) }, fakeRegistry([3000]));
    await runNodeProgramLifecycle(d);
    expect(d.exit).not.toHaveBeenCalled();
  });
});

describe('normalizeExitCode (Node uint8 coercion)', () => {
  it('passes through an in-range integer', () => {
    expect(normalizeExitCode(7)).toBe(7);
    expect(normalizeExitCode(0)).toBe(0);
    expect(normalizeExitCode(255)).toBe(255);
  });
  it('wraps out-of-range integers to 8 bits like Node', () => {
    expect(normalizeExitCode(256)).toBe(0);
    expect(normalizeExitCode(257)).toBe(1);
    expect(normalizeExitCode(-1)).toBe(255);
  });
  // normalizeExitCode is ONLY the final uint8 wrap — Node's string coercion +
  // loud validation lives in the process.exitCode SETTER (see install-process-gate
  // test). A raw non-number here is a defensive default to 0, NOT a parity claim
  // that this function coerces strings (the setter turns '7' into 7 first).
  it('defensively defaults a non-number to 0 (strings are coerced by the setter, not here)', () => {
    expect(normalizeExitCode(undefined)).toBe(0);
    expect(normalizeExitCode(Number.NaN)).toBe(0);
    expect(normalizeExitCode(null)).toBe(0);
  });
});
