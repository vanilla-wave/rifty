import { describe, expect, it, vi } from 'vitest';
import type { OwnerPtyRunAdmission, OwnerToPageFrame } from '../glue/pty-protocol.ts';
import {
  type DevServerFailure,
  type DevServerRunContext,
  DevServerRunError,
  type SupervisedDevServerHandle,
  createDevServerController,
  runDevServerShellCommand,
} from './dev-server-controller.ts';
import {
  HOST_PREVIEW_ORIGIN,
  type PreviewProducerOrigin,
  createPreviewRegistry,
} from './preview-registry.ts';

function ptyOrigin(ptySid: string, ptyRid: string): PreviewProducerOrigin {
  const admission = Object.freeze({ ptySid, ptyRid }) as OwnerPtyRunAdmission;
  return { kind: 'pty', admission };
}

function fakeBoot(port: number) {
  let stopped = 0;
  const handle: SupervisedDevServerHandle = {
    port,
    failure: new Promise<DevServerFailure>(() => {}),
    stop: async () => {
      stopped++;
      return { code: null, signal: 'SIGTERM' } as const;
    },
  };
  return { boot: async () => handle, stopped: () => stopped };
}

function commandContext(signal: AbortSignal): DevServerRunContext {
  const sink = { write: () => {} };
  return {
    cwd: '/workspace',
    env: {},
    stdout: sink,
    stderr: sink,
    signal,
  };
}

/** Controller + registry composed: frames the page actually sees. */
function wired(boot: (ctx: DevServerRunContext) => Promise<SupervisedDevServerHandle>) {
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
  it('drives the registry starting→running, then stopped on abort, in order', async () => {
    const { boot, stopped } = fakeBoot(5174);
    const { ctrl, dev } = wired(boot);
    const ac = new AbortController();
    const run = ctrl.run(commandContext(ac.signal), HOST_PREVIEW_ORIGIN);
    await Promise.resolve();
    await Promise.resolve();
    expect(dev().map((f) => [f.status, f.port])).toEqual([
      ['starting', undefined],
      ['running', 5174],
    ]);
    expect(ctrl.status).toBe('running');
    ac.abort();
    await expect(run).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(stopped()).toBe(1);
    expect(dev().at(-1)).toMatchObject({ status: 'stopped' });
    expect(ctrl.status).toBe('stopped');
  });

  it('tags lifecycle frames with the owning pty session id when provided', async () => {
    const { boot } = fakeBoot(5174);
    const { ctrl, dev } = wired(boot);
    const ac = new AbortController();
    const run = ctrl.run(commandContext(ac.signal), ptyOrigin('terminal-7', 'run-7'));
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
        cwd: '/workspace',
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
      return {
        port: 5174,
        failure: new Promise<DevServerFailure>(() => {}),
        stop: async () => ({ code: null, signal: 'SIGTERM' }) as const,
      };
    });
    const ac = new AbortController();
    const first = ctrl.run(commandContext(ac.signal), HOST_PREVIEW_ORIGIN);
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      ctrl.run(commandContext(new AbortController().signal), HOST_PREVIEW_ORIGIN),
    ).rejects.toThrow(/already running/i);
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
    const run = ctrl.run(commandContext(ac.signal), HOST_PREVIEW_ORIGIN);
    await Promise.resolve();
    await Promise.resolve();
    frames.length = 0;
    registry.publishDev();
    expect(dev().at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'running',
      port: 5174,
      url: '/preview/5174/',
      cwd: '/workspace',
    });
    ac.abort();
    await run;
  });

  it('a boot failure emits stopped{error} and stays recoverable', async () => {
    let calls = 0;
    const { ctrl, dev } = wired(async () => {
      calls++;
      if (calls === 1) throw new Error('vite blew up');
      return {
        port: 5174,
        failure: new Promise<DevServerFailure>(() => {}),
        stop: async () => ({ code: null, signal: 'SIGTERM' }) as const,
      };
    });
    await expect(
      ctrl.run(commandContext(new AbortController().signal), HOST_PREVIEW_ORIGIN),
    ).rejects.toThrow(/vite blew up/);
    expect(dev().at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      error: 'vite blew up',
    });
    expect(ctrl.status).toBe('stopped');
    // recoverable: a subsequent run boots again
    const ac = new AbortController();
    const run = ctrl.run(commandContext(ac.signal), HOST_PREVIEW_ORIGIN);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.status).toBe('running');
    ac.abort();
    await run;
  });

  it('treats an exact pre-ready abort settlement as cancellation, not boot failure', async () => {
    const { ctrl, dev } = wired(async () => {
      throw new DevServerRunError(new Error('dev-server boot aborted before ready'), {
        code: null,
        signal: 'SIGTERM',
      });
    });
    const abort = new AbortController();
    abort.abort();

    await expect(
      ctrl.run(commandContext(abort.signal), ptyOrigin('terminal-pre-ready', 'run-pre-ready')),
    ).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(dev().at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'terminal-pre-ready',
    });
  });

  it('shell adapter returns exact crash provenance while surfacing the diagnostic', async () => {
    const stderr: string[] = [];
    const controller = {
      status: 'stopped' as const,
      run: async () => {
        throw new DevServerRunError(new Error('dev child crashed'), {
          code: 7,
          signal: null,
        });
      },
    };
    const ctx = {
      ...commandContext(new AbortController().signal),
      stderr: { write: (chunk: string) => stderr.push(chunk) },
    };

    await expect(runDevServerShellCommand(controller, ctx, HOST_PREVIEW_ORIGIN)).resolves.toEqual({
      code: 7,
      signal: null,
    });
    expect(stderr.join('')).toBe('dev child crashed\n');
  });

  it('a bin/node server listening during a controller run keeps the pill running after stop', async () => {
    // Generic-lifecycle semantics: the pill reflects the LISTENING PORT SET, not
    // the controller alone — a foreground `node server.js` that is still
    // listening when the dev run stops keeps LIVE (with its own port).
    const { boot } = fakeBoot(5174);
    const { ctrl, registry, dev } = wired(boot);
    const ac = new AbortController();
    const run = ctrl.run(commandContext(ac.signal), ptyOrigin('terminal-1', 'run-1'));
    await Promise.resolve();
    await Promise.resolve();
    registry.addNode('node-1', [3000], 'scope-n', {
      origin: ptyOrigin('terminal-2', 'run-2'),
    });
    ac.abort();
    await run;
    expect(dev().at(-1)).toMatchObject({ status: 'running', port: 3000, sid: 'terminal-2' });
  });

  it('owns a post-ready child failure: stops the handle, clears LIVE, and rejects the run', async () => {
    let reportFailure: ((failure: DevServerFailure) => void) | undefined;
    const failure = new Promise<DevServerFailure>((resolve) => {
      reportFailure = resolve;
    });
    let stops = 0;
    const { ctrl, dev } = wired(async () => ({
      port: 5174,
      failure,
      stop: async () => {
        stops += 1;
        return { code: null, signal: 'SIGTERM' } as const;
      },
    }));
    const ac = new AbortController();
    const run = ctrl.run(commandContext(ac.signal), ptyOrigin('terminal-crash', 'run-crash'));
    const outcome = run.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.waitFor(() => expect(ctrl.status).toBe('running'));

    try {
      reportFailure?.({
        kind: 'exit',
        code: null,
        signal: 'SIGTERM',
        error: new Error('dev child exited after listening (code null, signal SIGTERM)'),
      });
      await vi.waitFor(() => expect(ctrl.status).toBe('stopped'));
      const result = await outcome;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          message: 'dev child exited after listening (code null, signal SIGTERM)',
          exit: { code: null, signal: 'SIGTERM' },
        });
      }
      expect(stops).toBe(1);
      expect(dev().at(-1)).toEqual({
        type: 'pty:dev-server',
        status: 'stopped',
        sid: 'terminal-crash',
        error: 'dev child exited after listening (code null, signal SIGTERM)',
      });
    } finally {
      ac.abort();
      await outcome;
    }
  });

  it('preserves a natural post-ready child exit in the controller error', async () => {
    let reportFailure: ((failure: DevServerFailure) => void) | undefined;
    const failure = new Promise<DevServerFailure>((resolve) => {
      reportFailure = resolve;
    });
    const { ctrl } = wired(async () => ({
      port: 5174,
      failure,
      stop: async () => ({ code: 7, signal: null }) as const,
    }));
    const ac = new AbortController();
    const run = ctrl.run(commandContext(ac.signal), HOST_PREVIEW_ORIGIN);
    await vi.waitFor(() => expect(ctrl.status).toBe('running'));

    reportFailure?.({
      kind: 'exit',
      code: 7,
      signal: null,
      error: new Error('dev child exited after listening (code 7, signal null)'),
    });

    await expect(run).rejects.toMatchObject({
      message: 'dev child exited after listening (code 7, signal null)',
      exit: { code: 7, signal: null },
    });
  });

  it('owns stop failure: clears LIVE, reports the error, and stays recoverable', async () => {
    let boots = 0;
    const { ctrl, dev } = wired(async () => {
      boots += 1;
      return {
        port: 5174,
        failure: new Promise<DevServerFailure>(() => {}),
        stop: async () => {
          if (boots === 1) throw new Error('dev stop transport failed');
          return { code: null, signal: 'SIGTERM' } as const;
        },
      };
    });
    const firstAbort = new AbortController();
    const first = ctrl.run(
      commandContext(firstAbort.signal),
      ptyOrigin('terminal-stop-fault', 'run-stop-fault'),
    );
    await vi.waitFor(() => expect(ctrl.status).toBe('running'));

    firstAbort.abort();

    await expect(first).rejects.toThrow('dev stop transport failed');
    expect(ctrl.status).toBe('stopped');
    expect(dev().at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'terminal-stop-fault',
      error: 'dev stop transport failed',
    });

    const secondAbort = new AbortController();
    const second = ctrl.run(
      commandContext(secondAbort.signal),
      ptyOrigin('terminal-retry', 'run-retry'),
    );
    await vi.waitFor(() => expect(ctrl.status).toBe('running'));
    secondAbort.abort();
    await second;
  });
});
