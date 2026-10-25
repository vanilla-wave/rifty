import { describe, expect, it, vi } from 'vitest';
import { type NodeLifecycleDeps, runNodeProgramLifecycle } from './node-program-lifecycle.ts';

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
    servePreview: vi.fn(() => () => {}),
    postListening: vi.fn(),
    exit: vi.fn(),
    ...over,
  };
  return { d, reg };
}

async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('runNodeProgramLifecycle', () => {
  // ADR-0445 rule 6 (ADR-0157 D4 moved into Node's `exit()`): natural exit passes
  // no code, so `exit()` emits 'exit' and reads process.exitCode itself. Status
  // proof: browser-unit `natural-exit-code`, parity `exit-lifecycle-child`.
  it('script (no listen): drains then calls exit() with no argument', async () => {
    const { d } = deps();
    await runNodeProgramLifecycle(d);
    expect(d.runEntry).toHaveBeenCalledOnce();
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.postListening).not.toHaveBeenCalled();
    expect(vi.mocked(d.exit).mock.calls).toEqual([[]]);
  });

  it('server (listened): serves each port while its single drain remains pending', async () => {
    const { d } = deps({}, fakeRegistry([3000, 8080]));
    void runNodeProgramLifecycle(d);
    await settle();
    expect(d.servePreview).toHaveBeenCalledTimes(2);
    expect(d.servePreview).toHaveBeenCalledWith(3000);
    expect(d.servePreview).toHaveBeenCalledWith(8080);
    expect(d.postListening).toHaveBeenCalledWith([3000, 8080]);
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('server whose entry stays pending after listen still posts ports', async () => {
    const { d } = deps(
      { runEntry: vi.fn(() => new Promise<void>(() => {})) },
      fakeRegistry([5174]),
    );
    void runNodeProgramLifecycle(d);
    await settle();
    expect(d.servePreview).toHaveBeenCalledWith(5174);
    expect(d.postListening).toHaveBeenCalledWith([5174]);
    expect(d.awaitDrain).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('pending entry without a port waits on events instead of exiting', async () => {
    const reg = fakeRegistry();
    const { d } = deps({ runEntry: vi.fn(() => new Promise<void>(() => {})) }, reg);
    let settled = false;
    void runNodeProgramLifecycle(d).then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false); // parked, not exited
    expect(d.exit).not.toHaveBeenCalled();
    reg.listen(4000); // a LATE listen event wakes the loop → server branch
    await settle();
    expect(settled).toBe(false);
    expect(d.servePreview).toHaveBeenCalledWith(4000);
    expect(d.postListening).toHaveBeenCalledWith([4000]);
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
    void runNodeProgramLifecycle(d);
    await settle();
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

  it('a listened server stays alive (no exit)', async () => {
    const { d } = deps({}, fakeRegistry([3000]));
    void runNodeProgramLifecycle(d);
    await settle();
    expect(d.exit).not.toHaveBeenCalled();
  });
});
