import type { ProcessExit } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectRun, ProjectSession } from '../workbench/project-session.ts';
import type {
  ProjectTerminal,
  ProjectTerminalRun,
  ProjectTerminalSnapshot,
} from '../workbench/project-terminal.ts';
import { createPlaygroundTerminalUi } from './playground-terminal-ui.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function terminalHarness() {
  const listeners = new Set<(chunk: string, stream: 'stdout' | 'stderr') => void>();
  const runExit = deferred<ProcessExit>();
  const run = {
    ready: Promise.resolve(),
    exited: runExit.promise,
    stop: vi.fn(async () => ({ code: null, signal: 'SIGINT' }) as ProcessExit),
    close: vi.fn(async () => ({ code: 0, signal: null }) as ProcessExit),
  } satisfies ProjectTerminalRun;
  let terminalState: ProjectTerminalSnapshot = Object.freeze({
    cwd: '/src',
    env: Object.freeze({ TERM: 'xterm' }),
  });
  const terminal = {
    snapshot: vi.fn(() => terminalState),
    run: vi.fn(() => run),
    write: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: vi.fn(async () => {}),
  } satisfies ProjectTerminal;
  return {
    terminal,
    run,
    runExit,
    setState(cwd: string, env: Readonly<Record<string, string>>) {
      terminalState = Object.freeze({ cwd, env: Object.freeze({ ...env }) });
    },
    emit(chunk: string, stream: 'stdout' | 'stderr' = 'stdout') {
      for (const listener of listeners) listener(chunk, stream);
    },
  };
}

describe('Playground semantic terminal UI adapter', () => {
  it('projects exact owner-acknowledged cwd/env before and after a terminal run', async () => {
    const primary = terminalHarness();
    const exited = deferred<ProcessExit>();
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: exited.promise,
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: { open: vi.fn() },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);

    const started = ui.startProject('Project');
    expect(ui.sessions()).toMatchObject([{ cwd: '/src', env: { TERM: 'xterm' } }]);

    primary.setState('/src/after', { AFTER: 'run' });
    exited.resolve({ code: 0, signal: null });
    await started.exited;

    expect(ui.sessions()).toMatchObject([{ cwd: '/src/after', env: { AFTER: 'run' } }]);
    await ui.dispose();
  });

  it('captures runtime install output before xterm mounts and replays it in observable order', async () => {
    const primary = terminalHarness();
    const ready = deferred<unknown>();
    const exited = deferred<ProcessExit>();
    const projectRun = {
      terminal: primary.terminal,
      ready: ready.promise,
      exited: exited.promise,
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: { open: vi.fn() },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);

    const started = ui.startProject('Project');
    primary.emit('$ npm install\n');
    primary.emit('npm: + kleur@4.1.5\n');
    const output: string[] = [];
    ui.attach(started.id, (chunk) => output.push(chunk));

    expect(output.join('')).toBe('$ npm install\nnpm: + kleur@4.1.5\n');
    expect(ui.sessions()).toMatchObject([{ id: started.id, title: 'Project', status: 'running' }]);

    ready.resolve(undefined);
    exited.resolve({ code: 0, signal: null });
    await started.exited;
    expect(ui.sessions()[0]).toMatchObject({ status: 'idle', exitCode: 0 });
    expect(projectRun.close).toHaveBeenCalledTimes(1);
    await ui.dispose();
  });

  it('brackets a finite CLI lifecycle around the exact project output', async () => {
    const primary = terminalHarness();
    const exited = deferred<ProcessExit>();
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: exited.promise,
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: { open: vi.fn() },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);

    const started = ui.startProject('CLI report scratch', {
      kind: 'node-cli',
      displayName: 'CLI report',
    });
    primary.emit('[cli] package report\n');
    const output: string[] = [];
    ui.attach(started.id, (chunk) => output.push(chunk));
    expect(output.join('')).toBe('cli: running CLI report\n[cli] package report\n');

    exited.resolve({ code: 0, signal: null });
    await started.exited;
    expect(output.join('')).toBe(
      'cli: running CLI report\n[cli] package report\n[cli] completed with exit code 0\n',
    );
    await ui.dispose();
  });

  it('delegates primary stop to the exact ProjectRun without terminal-id reconstruction', async () => {
    const primary = terminalHarness();
    const exactExit = { code: null, signal: 'SIGINT' } as ProcessExit;
    const stopOutcome = Promise.resolve(exactExit);
    const projectStop = vi.fn(() => stopOutcome);
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: new Promise<ProcessExit>(() => {}),
      stop: projectStop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: { open: vi.fn() },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);

    ui.startProject('Project');
    const firstStop = ui.stopProject();
    const secondStop = ui.stopProject();

    expect(firstStop).toBe(stopOutcome);
    expect(secondStop).toBe(stopOutcome);
    expect(projectStop).toHaveBeenCalledTimes(2);
    expect(primary.run.stop).not.toHaveBeenCalled();
    expect(session.run).toHaveBeenCalledTimes(1);
    await ui.dispose();
  });

  it('routes interactive line, stdin, resize and signal only through ProjectTerminal', async () => {
    const primary = terminalHarness();
    const interactive = terminalHarness();
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: new Promise<ProcessExit>(() => {}),
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: { open: vi.fn(() => interactive.terminal) },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);
    const opened = ui.createSession('Terminal 1');

    const line = ui.runLine(opened.id, 'node cli.mjs', { cols: 92, rows: 31 });
    await Promise.resolve();
    expect(interactive.terminal.resize).toHaveBeenCalledWith(92, 31);
    expect(interactive.terminal.run).toHaveBeenCalledWith('node cli.mjs');
    await ui.write(opened.id, 'answer\n');
    await ui.resize(opened.id, 100, 40);
    await ui.stop(opened.id);
    interactive.runExit.resolve({ code: 7, signal: null });

    await expect(line).resolves.toBe(7);
    expect(interactive.terminal.write).toHaveBeenCalledWith('answer\n');
    expect(interactive.run.stop).toHaveBeenCalledTimes(1);
    expect(interactive.run.close).toHaveBeenCalledTimes(1);
    await ui.dispose();
  });

  it('keeps empty and whitespace-only Enter as an idle no-op', async () => {
    const interactive = terminalHarness();
    const session = {
      files: {},
      documents: {},
      run: vi.fn(),
      terminals: { open: vi.fn(() => interactive.terminal) },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);
    const opened = ui.createSession('Terminal 1');

    await expect(ui.runLine(opened.id, ' \t ')).resolves.toBe(0);
    expect(interactive.terminal.run).not.toHaveBeenCalled();
    expect(interactive.terminal.resize).not.toHaveBeenCalled();
    expect(ui.sessions()[0]).toMatchObject({ status: 'idle' });
    await ui.dispose();
  });

  it('closes and releases an interactive run whose owner admission fails', async () => {
    const interactive = terminalHarness();
    const ready = deferred<void>();
    const exited = deferred<ProcessExit>();
    void exited.promise.catch(() => {});
    const failedRun = {
      ready: ready.promise,
      exited: exited.promise,
      stop: vi.fn(async () => ({ code: null, signal: 'SIGINT' }) as ProcessExit),
      close: vi.fn(async () => ({ code: 1, signal: null }) as ProcessExit),
    } satisfies ProjectTerminalRun;
    interactive.terminal.run.mockReturnValueOnce(failedRun);
    const session = {
      files: {},
      documents: {},
      run: vi.fn(),
      terminals: { open: vi.fn(() => interactive.terminal) },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);
    const opened = ui.createSession('Terminal 1');

    const line = ui.runLine(opened.id, 'node missing.mjs');
    const failure = new Error('owner admission failed');
    ready.reject(failure);
    exited.reject(failure);

    await expect(line).rejects.toBe(failure);
    expect(failedRun.close).toHaveBeenCalledTimes(1);
    expect(ui.sessions()[0]).toMatchObject({ status: 'idle' });
    await ui.dispose();
  });

  it('selects the previous surviving session after active close and retains active on sibling close', async () => {
    const primary = terminalHarness();
    const second = terminalHarness();
    const third = terminalHarness();
    const sibling = terminalHarness();
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: new Promise<ProcessExit>(() => {}),
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: {
        open: vi
          .fn<() => ProjectTerminal>()
          .mockReturnValueOnce(second.terminal)
          .mockReturnValueOnce(third.terminal)
          .mockReturnValueOnce(sibling.terminal),
      },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);

    const first = ui.startProject('Project');
    const previous = ui.createSession('Previous');
    const active = ui.createSession('Active');
    expect(ui.sessions().map(({ id }) => id)).toEqual([first.id, previous.id, active.id]);
    expect(ui.activeSessionId()).toBe(active.id);

    await ui.closeSession(active.id);
    expect(ui.activeSessionId()).toBe(previous.id);

    const nonActive = ui.createSession('Non-active');
    ui.select(previous.id);
    await ui.closeSession(nonActive.id);
    expect(ui.activeSessionId()).toBe(previous.id);
    await ui.dispose();
  });

  it('hides a closing tab and selects its fallback before owner close settles', async () => {
    const primary = terminalHarness();
    const previous = terminalHarness();
    const active = terminalHarness();
    const closeAck = deferred<void>();
    active.terminal.close.mockReturnValueOnce(closeAck.promise);
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: new Promise<ProcessExit>(() => {}),
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: {
        open: vi
          .fn<() => ProjectTerminal>()
          .mockReturnValueOnce(previous.terminal)
          .mockReturnValueOnce(active.terminal),
      },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);
    ui.startProject('Project');
    const fallback = ui.createSession('Previous');
    const closing = ui.createSession('Active');

    const failure = new Error('owner close failed');
    const close = ui.closeSession(closing.id);
    void close.catch(() => {});
    expect(ui.sessions().map(({ id }) => id)).not.toContain(closing.id);
    expect(ui.activeSessionId()).toBe(fallback.id);

    closeAck.reject(failure);
    await expect(close).rejects.toBe(failure);
    expect(ui.sessions().map(({ id }) => id)).not.toContain(closing.id);
    expect(ui.activeSessionId()).toBe(fallback.id);
    await ui.dispose();
  });

  it('disposes only page bindings while ProjectSession retains remote teardown authority', async () => {
    const primary = terminalHarness();
    const sibling = terminalHarness();
    const projectRun = {
      terminal: primary.terminal,
      ready: Promise.resolve(),
      exited: new Promise<ProcessExit>(() => {}),
      stop: primary.run.stop,
      close: primary.run.close,
    } satisfies ProjectRun<unknown>;
    const session = {
      files: {},
      documents: {},
      run: vi.fn(() => projectRun),
      terminals: { open: vi.fn(() => sibling.terminal) },
      close: vi.fn(),
    } as unknown as ProjectSession<unknown>;
    const ui = createPlaygroundTerminalUi(session);
    ui.startProject('Project');
    ui.createSession('Terminal 1');

    await ui.dispose();

    expect(projectRun.close).not.toHaveBeenCalled();
    expect(primary.terminal.close).not.toHaveBeenCalled();
    expect(sibling.terminal.close).not.toHaveBeenCalled();
    expect(ui.sessions()).toEqual([]);
  });
});
