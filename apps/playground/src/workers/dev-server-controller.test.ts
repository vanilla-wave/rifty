import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { type DevServerHandle, createDevServerController } from './dev-server-controller.ts';

function fakeBoot(port: number) {
  let stopped = 0;
  const handle: DevServerHandle = {
    port,
    stop: async () => {
      stopped++;
    },
  };
  return { boot: async () => handle, stopped: () => stopped };
}

describe('createDevServerController', () => {
  it('emits starting→running, then stopped on abort, in order', async () => {
    const frames: OwnerToPageFrame[] = [];
    const { boot, stopped } = fakeBoot(5174);
    const ctrl = createDevServerController({ send: (f) => frames.push(f), boot });
    const ac = new AbortController();
    const run = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      frames.map((f) => (f.type === 'pty:dev-server' ? [f.status, f.port] : ['?', undefined])),
    ).toEqual([
      ['starting', undefined],
      ['running', 5174],
    ]);
    expect(ctrl.status).toBe('running');
    ac.abort();
    await run;
    expect(stopped()).toBe(1);
    expect(frames.at(-1)).toEqual({ type: 'pty:dev-server', status: 'stopped' });
    expect(ctrl.status).toBe('stopped');
  });

  it('single-active guard: a second run while active throws and does not double-boot', async () => {
    let boots = 0;
    const ctrl = createDevServerController({
      send: () => {},
      boot: async () => {
        boots++;
        return { port: 5174, stop: async () => {} };
      },
    });
    const ac = new AbortController();
    const first = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    await expect(ctrl.run(new AbortController().signal)).rejects.toThrow(/already running/i);
    expect(boots).toBe(1);
    ac.abort();
    await first;
  });

  it('publish() re-emits the current state (the req handshake)', async () => {
    const frames: OwnerToPageFrame[] = [];
    const { boot } = fakeBoot(5174);
    const ctrl = createDevServerController({ send: (f) => frames.push(f), boot });
    ctrl.publish();
    expect(frames.at(-1)).toEqual({ type: 'pty:dev-server', status: 'stopped' });
    const ac = new AbortController();
    const run = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    frames.length = 0;
    ctrl.publish();
    expect(frames.at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'running',
      port: 5174,
      url: '/preview/5174/',
    });
    ac.abort();
    await run;
  });

  it('notifyFileChanged forwards to the running handle only', async () => {
    const changed: string[] = [];
    const ctrl = createDevServerController({
      send: () => {},
      boot: async () => ({
        port: 5174,
        stop: async () => {},
        onFileChanged: (p) => changed.push(p),
      }),
    });
    // stopped: forwarding is a no-op
    ctrl.notifyFileChanged('/workspace/src/a.js');
    expect(changed).toEqual([]);
    const ac = new AbortController();
    const run = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    ctrl.notifyFileChanged('/workspace/src/b.js');
    expect(changed).toEqual(['/workspace/src/b.js']);
    ac.abort();
    await run;
  });

  it('a boot failure emits stopped{error} and stays recoverable', async () => {
    const frames: OwnerToPageFrame[] = [];
    let calls = 0;
    const ctrl = createDevServerController({
      send: (f) => frames.push(f),
      boot: async () => {
        calls++;
        if (calls === 1) throw new Error('vite blew up');
        return { port: 5174, stop: async () => {} };
      },
    });
    await expect(ctrl.run(new AbortController().signal)).rejects.toThrow(/vite blew up/);
    expect(frames.at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      error: 'vite blew up',
    });
    expect(ctrl.status).toBe('stopped');
    // recoverable: a subsequent run boots again
    const ac = new AbortController();
    const run = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.status).toBe('running');
    ac.abort();
    await run;
  });
});
