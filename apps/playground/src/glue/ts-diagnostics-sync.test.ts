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
});
