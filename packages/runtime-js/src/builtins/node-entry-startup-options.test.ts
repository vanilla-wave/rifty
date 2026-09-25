/**
 * ADR-0449 §4: node-entry v6 carries the exact startup tokens of program and
 * worker-thread launches; the decoder re-runs the startup-options compiler, so
 * a token rifty cannot honour is a protocol error, never a silently different
 * child (Fault matrix `corrupt-input` × launch decode).
 */
import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  type NodeEntryLaunch,
  buildNodeEntryWorkerEntry,
  readNodeEntryBootstrap,
} from './node-entry-runtime-config.ts';

const HOST_RUNTIME = { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' };
const TOKENS = ['--require', '/app/pre.cjs', '-C', 'custom', '--experimental-import-meta-resolve'];

const LAUNCHES: Readonly<Record<'program' | 'worker-thread', Readonly<Record<string, unknown>>>> = {
  program: { kind: 'program', bin: false, remoteFs: true, nodeServe: true, ipc: 'advanced' },
  'worker-thread': { kind: 'worker-thread', remoteFs: true, threadId: 1 },
};

function launchWith(kind: keyof typeof LAUNCHES, execArgv: unknown): NodeEntryLaunch {
  return { ...LAUNCHES[kind], execArgv } as unknown as NodeEntryLaunch;
}

afterEach(() => {
  publishKernelEntryBootstrap(null);
});

describe('node-entry v6 startup tokens (ADR-0449)', () => {
  it('is the one atomic node-entry v6 wire contract', () => {
    expect(NODE_ENTRY_BOOTSTRAP_PROTOCOL).toBe('rifty.node-entry/v6');
  });

  it.each(['program', 'worker-thread'] as const)(
    'carries an exact snapshot of %s launch execArgv through decode',
    (kind) => {
      const execArgv = [...TOKENS];
      const entry = buildNodeEntryWorkerEntry(
        'https://host.test/node.js',
        HOST_RUNTIME,
        launchWith(kind, execArgv),
      );
      execArgv.push('--mutated-after-build');
      publishKernelEntryBootstrap(entry.bootstrap ?? null);

      expect(readNodeEntryBootstrap().launch).toMatchObject({ kind, execArgv: TOKENS });
    },
  );

  it.each([
    ['an unsupported flag', ['--no-warnings']],
    ['a missing operand', ['--require']],
    ['an empty inline operand', ['--conditions=']],
    ['a non-string token', [42]],
    ['a non-array value', '--require'],
  ])('rejects a launch carrying %s', (_label, execArgv) => {
    for (const kind of ['program', 'worker-thread'] as const) {
      expect(() =>
        buildNodeEntryWorkerEntry(
          'https://host.test/node.js',
          HOST_RUNTIME,
          launchWith(kind, execArgv),
        ),
      ).toThrow(/execArgv/);
      publishKernelEntryBootstrap({
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: { hostRuntime: HOST_RUNTIME, launch: launchWith(kind, execArgv) },
      });
      expect(() => readNodeEntryBootstrap()).toThrow(/execArgv/);
    }
  });

  it('rejects a v5 envelope (no dual reader)', () => {
    publishKernelEntryBootstrap({
      protocol: 'rifty.node-entry/v5',
      payload: { hostRuntime: HOST_RUNTIME, launch: LAUNCHES.program },
    });
    expect(() => readNodeEntryBootstrap()).toThrow(/protocol/i);
  });
});
