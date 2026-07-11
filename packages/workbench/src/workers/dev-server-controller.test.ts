import type { TerminalResizeSource } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { type DevServerHandle, createDevServerController } from './dev-server-controller.ts';
import { createPreviewRegistry } from './preview-registry.ts';

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

/** Controller + registry composed: frames the page actually sees. */
function wired(boot: (signal: AbortSignal) => Promise<DevServerHandle>) {
  const frames: OwnerToPageFrame[] = [];
  const registry = createPreviewRegistry({ send: (f) => frames.push(f) });
  const ctrl = createDevServerController({ lifecycle: registry, boot });
  const dev = () =>
    frames.filter(
      (f): f is Extract<OwnerToPageFrame, { type: 'pty:dev-server' }> =>
        f.type === 'pty:dev-server',
    );
  return { frames, registry, ctrl, dev };
}

describe('createDevServerController', () => {
  it('passes the run-scoped terminal resize source to the boot boundary', async () => {
    let received: TerminalResizeSource | undefined;
    const terminal: TerminalResizeSource = {
      current: () => ({ cols: 100, rows: 30 }),
      subscribe: () => () => {},
    };
    const frames: OwnerToPageFrame[] = [];
    const registry = createPreviewRegistry({ send: (frame) => frames.push(frame) });
    const ctrl = createDevServerController({
      lifecycle: registry,
      boot: async (_signal, _log, _sid, resizeSource) => {
        received = resizeSource;
        return { port: 5174, stop: async () => {} };
      },
    });
    const ac = new AbortController();
    const run = ctrl.run(ac.signal, undefined, 'terminal-1', '/workspace', terminal);
    await Promise.resolve();
    expect(received).toBe(terminal);
    ac.abort();
    await run;
  });

  it('drives the registry starting→running, then stopped on abort, in order', async () => {
    const { boot, stopped } = fakeBoot(5174);
    const { ctrl, dev } = wired(boot);
    const ac = new AbortController();
    const run = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(dev().map((f) => [f.status, f.port])).toEqual([
      ['starting', undefined],
      ['running', 5174],
    ]);
    expect(ctrl.status).toBe('running');
    ac.abort();
    await run;
    expect(stopped()).toBe(1);
    expect(dev().at(-1)).toMatchObject({ status: 'stopped' });
    expect(ctrl.status).toBe('stopped');
  });

  it('tags lifecycle frames with the owning pty session id when provided', async () => {
    const { boot } = fakeBoot(5174);
    const { ctrl, dev } = wired(boot);
    const ac = new AbortController();
    const run = ctrl.run(ac.signal, undefined, 'terminal-7');
    await Promise.resolve();
    await Promise.resolve();
    expect(dev()).toEqual([
      { type: 'pty:dev-server', status: 'starting', sid: 'terminal-7' },
      {
        type: 'pty:dev-server',
        status: 'running',
        sid: 'terminal-7',
        port: 5174,
        url: '/preview/5174/',
      },
    ]);
    ac.abort();
    await run;
    expect(dev().at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'terminal-7',
    });
  });

  it('single-active guard: a second run while active throws and does not double-boot', async () => {
    let boots = 0;
    const { ctrl } = wired(async () => {
      boots++;
      return { port: 5174, stop: async () => {} };
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

  it('the registry answers the dev-server-req handshake for the controller-run server', async () => {
    const { boot } = fakeBoot(5174);
    const { ctrl, registry, frames, dev } = wired(boot);
    registry.publishDev();
    expect(dev().at(-1)).toEqual({ type: 'pty:dev-server', status: 'stopped' });
    const ac = new AbortController();
    const run = ctrl.run(ac.signal);
    await Promise.resolve();
    await Promise.resolve();
    frames.length = 0;
    registry.publishDev();
    expect(dev().at(-1)).toEqual({
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
    const { ctrl } = wired(async () => ({
      port: 5174,
      stop: async () => {},
      onFileChanged: (p) => changed.push(p),
    }));
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
    let calls = 0;
    const { ctrl, dev } = wired(async () => {
      calls++;
      if (calls === 1) throw new Error('vite blew up');
      return { port: 5174, stop: async () => {} };
    });
    await expect(ctrl.run(new AbortController().signal)).rejects.toThrow(/vite blew up/);
    expect(dev().at(-1)).toEqual({
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

  it('a bin/node server listening during a controller run keeps the pill running after stop', async () => {
    // Generic-lifecycle semantics: the pill reflects the LISTENING PORT SET, not
    // the controller alone — a foreground `node server.js` that is still
    // listening when the dev run stops keeps LIVE (with its own port).
    const { boot } = fakeBoot(5174);
    const { ctrl, registry, dev } = wired(boot);
    const ac = new AbortController();
    const run = ctrl.run(ac.signal, undefined, 'terminal-1');
    await Promise.resolve();
    await Promise.resolve();
    registry.addNode('node-1', [3000], 'scope-n', { ptySid: 'terminal-2' });
    ac.abort();
    await run;
    expect(dev().at(-1)).toMatchObject({ status: 'running', port: 3000, sid: 'terminal-2' });
  });
});
