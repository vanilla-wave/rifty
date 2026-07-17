import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TsDiagnosticsClient, createTsDiagnosticsSync } from './ts-diagnostics-sync.ts';

interface TestDiagnostic {
  readonly message: string;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createTsDiagnosticsSync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops out-of-order diagnostics for older or closed document generations', async () => {
    vi.useFakeTimers();
    const firstSemantic = deferred<readonly TestDiagnostic[]>();
    const secondSemantic = deferred<readonly TestDiagnostic[]>();
    const firstSyntactic = deferred<readonly TestDiagnostic[]>();
    const secondSyntactic = deferred<readonly TestDiagnostic[]>();
    const semantic = [firstSemantic, secondSemantic];
    const syntactic = [firstSyntactic, secondSyntactic];
    const client: TsDiagnosticsClient<TestDiagnostic> = {
      open: () => Promise.resolve(),
      update: () => Promise.resolve(),
      close: () => Promise.resolve(),
      getSemanticDiagnostics: () => {
        const next = semantic.shift();
        if (!next) throw new Error('unexpected semantic diagnostics request');
        return next.promise;
      },
      getSyntacticDiagnostics: () => {
        const next = syntactic.shift();
        if (!next) throw new Error('unexpected syntactic diagnostics request');
        return next.promise;
      },
    };
    const markerCalls: Array<{ path: string; markers: readonly string[] }> = [];
    let diagnostics = new Map<string, readonly TestDiagnostic[]>();
    const sync = createTsDiagnosticsSync<TestDiagnostic, string>({
      client,
      debounceMs: 0,
      isSupportedPath: (path) => path.endsWith('.ts'),
      setMarkers: (path, markers) => markerCalls.push({ path, markers }),
      setDiagnostics: (updater) => {
        diagnostics = updater(diagnostics);
      },
      toMarkers: (diags) => diags.map((diag) => diag.message),
      warn: () => undefined,
    });

    sync.handleDocument({ kind: 'open', path: '/scratch/src/main.ts', text: 'bad' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    sync.handleDocument({ kind: 'change', path: '/scratch/src/main.ts', text: 'good' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();

    secondSemantic.resolve([]);
    secondSyntactic.resolve([]);
    await flushAsync();
    expect(markerCalls).toEqual([{ path: '/scratch/src/main.ts', markers: [] }]);
    expect(diagnostics.has('/scratch/src/main.ts')).toBe(false);

    sync.handleDocument({ kind: 'close', path: '/scratch/src/main.ts', text: '' });
    firstSemantic.resolve([{ message: 'stale' }]);
    firstSyntactic.resolve([]);
    await flushAsync();

    expect(markerCalls).toEqual([
      { path: '/scratch/src/main.ts', markers: [] },
      { path: '/scratch/src/main.ts', markers: [] },
    ]);
    expect(diagnostics.has('/scratch/src/main.ts')).toBe(false);
    sync.dispose();
  });

  it('refreshes diagnostics for already-open documents without a document event', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const client: TsDiagnosticsClient<TestDiagnostic> = {
      open: () => Promise.resolve(),
      update: () => Promise.resolve(),
      close: () => Promise.resolve(),
      getSemanticDiagnostics: (path) => {
        calls.push(`semantic:${path}`);
        return Promise.resolve([{ message: 'semantic' }]);
      },
      getSyntacticDiagnostics: (path) => {
        calls.push(`syntactic:${path}`);
        return Promise.resolve([{ message: 'syntactic' }]);
      },
    };
    const markerCalls: Array<{ path: string; markers: readonly string[] }> = [];
    let diagnostics = new Map<string, readonly TestDiagnostic[]>();
    const sync = createTsDiagnosticsSync<TestDiagnostic, string>({
      client,
      debounceMs: 0,
      isSupportedPath: (path) => path.endsWith('.ts'),
      setMarkers: (path, markers) => markerCalls.push({ path, markers }),
      setDiagnostics: (updater) => {
        diagnostics = updater(diagnostics);
      },
      toMarkers: (diags) => diags.map((diag) => diag.message),
      warn: () => undefined,
    });

    sync.handleDocument({ kind: 'open', path: '/scratch/src/main.ts', text: 'bad' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    calls.length = 0;
    await sync.refreshOpenDiagnostics();
    await flushAsync();

    expect(calls).toEqual(['semantic:/scratch/src/main.ts', 'syntactic:/scratch/src/main.ts']);
    expect(markerCalls.at(-1)).toEqual({
      path: '/scratch/src/main.ts',
      markers: ['syntactic', 'semantic'],
    });
    expect(diagnostics.get('/scratch/src/main.ts')).toEqual([
      { message: 'syntactic' },
      { message: 'semantic' },
    ]);
    sync.dispose();
  });

  it('waits for the request gate before opening a document and reading diagnostics', async () => {
    vi.useFakeTimers();
    const gate = deferred<void>();
    const calls: string[] = [];
    const client: TsDiagnosticsClient<TestDiagnostic> = {
      open: (path) => {
        calls.push(`open:${path}`);
        return Promise.resolve();
      },
      update: () => Promise.resolve(),
      close: () => Promise.resolve(),
      getSemanticDiagnostics: (path) => {
        calls.push(`semantic:${path}`);
        return Promise.resolve([]);
      },
      getSyntacticDiagnostics: (path) => {
        calls.push(`syntactic:${path}`);
        return Promise.resolve([]);
      },
    };
    const sync = createTsDiagnosticsSync<TestDiagnostic, string>({
      client,
      debounceMs: 0,
      isSupportedPath: (path) => path.endsWith('.ts'),
      setMarkers: () => undefined,
      setDiagnostics: () => undefined,
      toMarkers: () => [],
      beforeRequest: () => gate.promise,
      warn: () => undefined,
    });

    sync.handleDocument({ kind: 'open', path: '/scratch/src/main.ts', text: 'bad' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    expect(calls).toEqual([]);

    gate.resolve();
    await flushAsync();
    expect(calls).toEqual([
      'open:/scratch/src/main.ts',
      'semantic:/scratch/src/main.ts',
      'syntactic:/scratch/src/main.ts',
    ]);
    sync.dispose();
  });

  it('reopens the latest live text after reinit without losing an overlapping edit', async () => {
    vi.useFakeTimers();
    const replayOpen = deferred<void>();
    const writes: Array<{ kind: 'open' | 'update'; path: string; text: string }> = [];
    let openCount = 0;
    let clientText = '';
    const client: TsDiagnosticsClient<TestDiagnostic> = {
      open: (path, text) => {
        writes.push({ kind: 'open', path, text });
        openCount += 1;
        if (openCount === 1) {
          clientText = text;
          return Promise.resolve();
        }
        return replayOpen.promise.then(() => {
          clientText = text;
        });
      },
      update: (path, text) => {
        writes.push({ kind: 'update', path, text });
        clientText = text;
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
      getSemanticDiagnostics: () => Promise.resolve([{ message: `semantic:${clientText}` }]),
      getSyntacticDiagnostics: () => Promise.resolve([]),
    };
    const markerCalls: Array<{ path: string; markers: readonly string[] }> = [];
    let diagnostics = new Map<string, readonly TestDiagnostic[]>();
    const sync = createTsDiagnosticsSync<TestDiagnostic, string>({
      client,
      debounceMs: 10,
      isSupportedPath: (path) => path.endsWith('.ts'),
      setMarkers: (path, markers) => markerCalls.push({ path, markers }),
      setDiagnostics: (updater) => {
        diagnostics = updater(diagnostics);
      },
      toMarkers: (diags) => diags.map((diag) => diag.message),
      warn: () => undefined,
    });

    sync.handleDocument({ kind: 'open', path: '/scratch/src/main.ts', text: 'T0' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    expect(clientText).toBe('T0');
    markerCalls.length = 0;

    const replay = sync.reopenOpenDocuments();
    await flushAsync();
    expect(writes.at(-1)).toEqual({
      kind: 'open',
      path: '/scratch/src/main.ts',
      text: 'T0',
    });
    expect(markerCalls).toEqual([{ path: '/scratch/src/main.ts', markers: [] }]);
    expect(diagnostics.has('/scratch/src/main.ts')).toBe(false);

    sync.handleDocument({ kind: 'change', path: '/scratch/src/main.ts', text: 'T1' });
    replayOpen.resolve();
    await replay;
    await flushAsync();
    expect(markerCalls).toEqual([{ path: '/scratch/src/main.ts', markers: [] }]);

    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    expect(clientText).toBe('T1');
    expect(writes.at(-1)).toEqual({
      kind: 'update',
      path: '/scratch/src/main.ts',
      text: 'T1',
    });
    expect(markerCalls.at(-1)).toEqual({
      path: '/scratch/src/main.ts',
      markers: ['semantic:T1'],
    });
    expect(diagnostics.get('/scratch/src/main.ts')).toEqual([{ message: 'semantic:T1' }]);
    sync.dispose();
  });

  it('reopens only supported live documents and cancels their pre-reinit timers', async () => {
    vi.useFakeTimers();
    const writes: Array<{ kind: 'open' | 'update'; path: string; text: string }> = [];
    const client: TsDiagnosticsClient<TestDiagnostic> = {
      open: (path, text) => {
        writes.push({ kind: 'open', path, text });
        return Promise.resolve();
      },
      update: (path, text) => {
        writes.push({ kind: 'update', path, text });
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
      getSemanticDiagnostics: () => Promise.resolve([]),
      getSyntacticDiagnostics: () => Promise.resolve([]),
    };
    const sync = createTsDiagnosticsSync<TestDiagnostic, string>({
      client,
      debounceMs: 10,
      isSupportedPath: (path) => path.endsWith('.ts'),
      setMarkers: () => undefined,
      setDiagnostics: () => undefined,
      toMarkers: () => [],
      warn: () => undefined,
    });

    sync.handleDocument({ kind: 'open', path: '/scratch/live.ts', text: 'T0' });
    sync.handleDocument({ kind: 'open', path: '/scratch/closed.ts', text: 'closed' });
    sync.handleDocument({ kind: 'open', path: '/scratch/ignored.txt', text: 'ignored' });
    sync.handleDocument({ kind: 'close', path: '/scratch/closed.ts', text: '' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    writes.length = 0;

    sync.handleDocument({ kind: 'change', path: '/scratch/live.ts', text: 'T1' });
    await sync.reopenOpenDocuments();
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();

    expect(writes).toEqual([{ kind: 'open', path: '/scratch/live.ts', text: 'T1' }]);
    sync.dispose();
  });

  it('closes a document whose close overlaps its replay open', async () => {
    vi.useFakeTimers();
    const replayOpen = deferred<void>();
    const calls: string[] = [];
    let openCount = 0;
    const client: TsDiagnosticsClient<TestDiagnostic> = {
      open: (path) => {
        openCount += 1;
        calls.push(`open:${path}`);
        return openCount === 1 ? Promise.resolve() : replayOpen.promise;
      },
      update: () => Promise.resolve(),
      close: (path) => {
        calls.push(`close:${path}`);
        return Promise.resolve();
      },
      getSemanticDiagnostics: () => Promise.resolve([]),
      getSyntacticDiagnostics: () => Promise.resolve([]),
    };
    const sync = createTsDiagnosticsSync<TestDiagnostic, string>({
      client,
      debounceMs: 0,
      isSupportedPath: (path) => path.endsWith('.ts'),
      setMarkers: () => undefined,
      setDiagnostics: () => undefined,
      toMarkers: () => [],
      warn: () => undefined,
    });

    sync.handleDocument({ kind: 'open', path: '/scratch/main.ts', text: 'T0' });
    await vi.runOnlyPendingTimersAsync();
    await flushAsync();
    calls.length = 0;

    const replay = sync.reopenOpenDocuments();
    await flushAsync();
    sync.handleDocument({ kind: 'close', path: '/scratch/main.ts', text: '' });
    replayOpen.resolve();
    await replay;
    await flushAsync();

    expect(calls).toEqual(['open:/scratch/main.ts', 'close:/scratch/main.ts']);
    calls.length = 0;
    await sync.reopenOpenDocuments();
    expect(calls).toEqual([]);
    sync.dispose();
  });
});
