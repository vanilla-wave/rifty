import { afterEach, describe, expect, it } from 'vitest';
import { type AgentBenchNamespace, installAgentBench } from './agent-bench.ts';
import { parseAgentBenchFlag } from './preset-deep-link.ts';

type BenchGlobal = typeof globalThis & { __riftyAgentBench?: AgentBenchNamespace };

afterEach(() => {
  (globalThis as BenchGlobal).__riftyAgentBench = undefined;
});

describe('parseAgentBenchFlag', () => {
  it('is on only for ?agentBench=1/true', () => {
    expect(parseAgentBenchFlag('?agentBench=1')).toBe(true);
    expect(parseAgentBenchFlag('?preset=react-vite&agentBench=true')).toBe(true);
    expect(parseAgentBenchFlag('?agentBench=0')).toBe(false);
    expect(parseAgentBenchFlag('?agentBench')).toBe(false);
    expect(parseAgentBenchFlag('')).toBe(false);
  });
});

describe('installAgentBench', () => {
  it('installs the single namespace and routes seed to the host', async () => {
    const seeded: Record<string, string>[] = [];
    installAgentBench({
      seedFiles: (files) => {
        seeded.push(files);
        return Promise.resolve();
      },
      presetId: () => 'react-vite',
    });
    const bench = (globalThis as BenchGlobal).__riftyAgentBench;
    expect(bench).toBeDefined();
    await bench?.seed({ 'src/x.txt': 'seeded' });
    expect(seeded).toEqual([{ 'src/x.txt': 'seeded' }]);
  });

  it('exportTrace / sessionMetadata throw loudly without a session, then observe the registered one', async () => {
    const registrar = installAgentBench({
      seedFiles: () => Promise.resolve(),
      presetId: () => 'react-vite',
    });
    const bench = (globalThis as BenchGlobal).__riftyAgentBench;
    if (!bench) throw new Error('namespace missing');
    await expect(bench.exportTrace()).rejects.toThrow(/no AI session/);
    expect(() => bench.sessionMetadata()).toThrow(/no AI session/);

    registrar.registerSession({
      exportTrace: () => Promise.resolve({ version: 1 }),
      sessionMetadata: () => ({
        promptProfile: 'pi-baseline+rifty-adapter-v1',
        model: 'mock-model',
        limits: { maxToolCalls: 50, runTimeoutMs: 600_000 },
      }),
    });
    await expect(bench.exportTrace()).resolves.toEqual({ version: 1 });
    expect(bench.sessionMetadata()).toEqual({
      promptProfile: 'pi-baseline+rifty-adapter-v1',
      model: 'mock-model',
      limits: { maxToolCalls: 50, runTimeoutMs: 600_000 },
      presetId: 'react-vite',
    });

    // Reset (null) drops back to the loud no-session state.
    registrar.registerSession(null);
    await expect(bench.exportTrace()).rejects.toThrow(/no AI session/);
  });
});
