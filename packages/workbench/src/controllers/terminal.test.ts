import { describe, expect, it, vi } from 'vitest';
import type {
  TerminalManager,
  TerminalRawInput,
  TerminalSessionSnapshot,
  TerminalWriter,
} from '../glue/terminal-manager.ts';
import type { ProjectSpec } from '../project-spec.ts';
import { type TerminalProject, createTerminalController } from './terminal.ts';

const VITE_SPEC: ProjectSpec = {
  id: 'vite-basic',
  displayName: 'Vite',
  runtime: 'vite',
  install: { vite: '1.0.0' },
  entry: { relativePath: '/src/main.js', content: 'console.log(1)' },
  defaultPort: 5173,
  estimatedBootSeconds: 1,
  runtimeSpecifier: 'vite',
  htmlTitle: 'Vite',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: true },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeManager() {
  const state = new Map<string, TerminalSessionSnapshot>([
    [
      'terminal-1',
      {
        id: 'terminal-1',
        title: 'Terminal 1',
        cwd: '/workspace',
        env: {},
        status: 'idle',
      },
    ],
  ]);
  let active = 'terminal-1';
  let next = 2;
  const writers = new Map<string, TerminalWriter | null>();
  const runLine = vi.fn(async (id: string, line: string) => {
    const current = state.get(id);
    if (!current) throw new Error(`Unknown terminal session: ${id}`);
    state.set(id, { ...current, status: 'running' });
    writers.get(id)?.(`ran:${line}\n`);
    state.set(id, { ...current, status: 'idle', exitCode: 0 });
    return 0;
  });
  const manager: TerminalManager = {
    sessions: () => [...state.values()],
    snapshot: (id) => {
      const snapshot = state.get(id);
      if (!snapshot) throw new Error(`Unknown terminal session: ${id}`);
      return snapshot;
    },
    activeSessionId: () => active,
    createSession: (title) => {
      const id = `terminal-${next++}`;
      const snapshot: TerminalSessionSnapshot = {
        id,
        title: title ?? `Terminal ${next - 1}`,
        cwd: '/workspace',
        env: {},
        status: 'idle',
      };
      state.set(id, snapshot);
      return snapshot;
    },
    select: (id) => {
      if (!state.has(id)) throw new Error(`Unknown terminal session: ${id}`);
      active = id;
    },
    attachWriter: (id, writer) => {
      writers.set(id, writer);
    },
    clear: vi.fn(),
    freshConsole: vi.fn(),
    writeStdin: vi.fn((_id: string, _data: TerminalRawInput) => {}),
    resize: vi.fn(),
    runLine,
    runSequence: vi.fn(async () => 0),
    rebindOwner: vi.fn(async () => {}),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  return { manager, runLine, writers };
}

describe('terminal controller', () => {
  it('exposes attach/write/resize/run and observable session state', async () => {
    const { manager, writers } = fakeManager();
    const controller = createTerminalController({
      manager,
      project: { spec: VITE_SPEC, root: '/workspace', setup: 'instant' },
    });
    const snapshots: number[] = [];
    const unsubscribe = controller.subscribe((snapshot) =>
      snapshots.push(snapshot.sessions.length),
    );
    const output: string[] = [];
    const detach = controller.attach('terminal-1', (chunk) => output.push(chunk));

    controller.write('terminal-1', 'x');
    controller.resize('terminal-1', 100, 40);
    await expect(controller.run('terminal-1', 'node -v')).resolves.toBe(0);
    controller.createSession('Build');

    expect(manager.writeStdin).toHaveBeenCalledWith('terminal-1', 'x');
    expect(manager.resize).toHaveBeenCalledWith('terminal-1', { cols: 100, rows: 40 });
    expect(output).toEqual(['ran:node -v\n']);
    expect(snapshots.at(-1)).toBe(2);
    detach();
    expect(writers.get('terminal-1')).toBeNull();
    unsubscribe();
    controller.dispose();
    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(() => controller.snapshot()).toThrow('terminal controller disposed');
  });

  it('runs an instant project directly and a from-scratch project through explicit npm install', async () => {
    const instant = fakeManager();
    const instantController = createTerminalController({
      manager: instant.manager,
      project: { spec: VITE_SPEC, root: '/workspace', setup: 'instant' },
    });
    await instantController.runProject('terminal-1');
    expect(instant.runLine).toHaveBeenCalledWith('terminal-1', 'vite --port 5173', undefined);
    instantController.dispose();

    const scratch = fakeManager();
    const scratchController = createTerminalController({
      manager: scratch.manager,
      project: { spec: VITE_SPEC, root: '/workspace', setup: 'from-scratch' },
    });
    await scratchController.runProject('terminal-1');
    expect(scratch.runLine).toHaveBeenCalledWith(
      'terminal-1',
      'cd /workspace && npm install && vite --port 5173',
      undefined,
    );
    scratchController.dispose();
  });

  it('resolves the active project at runProject time for a host that switches roots', async () => {
    const fake = fakeManager();
    let project: TerminalProject = { spec: VITE_SPEC, root: '/scratch', setup: 'instant' };
    const controller = createTerminalController({ manager: fake.manager, project: () => project });

    await controller.runProject('terminal-1');
    project = { spec: VITE_SPEC, root: '/projects/next', setup: 'from-scratch' };
    await controller.runProject('terminal-1');

    expect(fake.runLine).toHaveBeenNthCalledWith(1, 'terminal-1', 'vite --port 5173', undefined);
    expect(fake.runLine).toHaveBeenNthCalledWith(
      2,
      'terminal-1',
      'cd /projects/next && npm install && vite --port 5173',
      undefined,
    );
    controller.dispose();
  });

  it('shell-quotes a host-injected workspace root without changing the command', async () => {
    const scratch = fakeManager();
    const controller = createTerminalController({
      manager: scratch.manager,
      project: { spec: VITE_SPEC, root: "/my work's", setup: 'from-scratch' },
    });
    await controller.runProject('terminal-1');
    expect(scratch.runLine).toHaveBeenCalledWith(
      'terminal-1',
      `cd '/my work'"'"'s' && npm install && vite --port 5173`,
      undefined,
    );
    controller.dispose();
  });

  it('dispose during a run stops every running session before closing PTYs', async () => {
    const { manager } = fakeManager();
    const gate = deferred<number>();
    vi.mocked(manager.runLine).mockImplementation(async () => gate.promise);
    const controller = createTerminalController({
      manager,
      project: { spec: VITE_SPEC, root: '/workspace', setup: 'instant' },
    });
    const run = controller.run('terminal-1', 'npm install');
    controller.dispose();
    expect(manager.stop).toHaveBeenCalledWith('terminal-1');
    gate.resolve(130);
    await expect(run).resolves.toBe(130);
  });

  it('attempts every stop and manager teardown before aggregating dispose failures', async () => {
    const { manager } = fakeManager();
    const gate = deferred<number>();
    vi.mocked(manager.runLine).mockImplementation(async () => gate.promise);
    vi.mocked(manager.stop).mockImplementation((id) => {
      if (id === 'terminal-1') throw new Error('first stop failed');
    });
    vi.mocked(manager.dispose).mockImplementation(() => {
      throw new Error('manager dispose failed');
    });
    const controller = createTerminalController({
      manager,
      project: { spec: VITE_SPEC, root: '/workspace', setup: 'instant' },
    });
    const second = controller.createSession('Second');
    const firstRun = controller.run('terminal-1', 'first');
    const secondRun = controller.run(second.id, 'second');

    expect(() => controller.dispose()).toThrow(AggregateError);
    expect(manager.stop).toHaveBeenCalledWith('terminal-1');
    expect(manager.stop).toHaveBeenCalledWith(second.id);
    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(() => controller.dispose()).not.toThrow();

    gate.resolve(130);
    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([130, 130]);
  });
});
