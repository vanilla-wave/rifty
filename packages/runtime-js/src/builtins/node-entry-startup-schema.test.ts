import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, expect, it } from 'vitest';
import {
  type NodeEntryLaunch,
  buildNodeEntryWorkerEntry,
  readNodeEntryBootstrap,
  readNodeEntryBootstrapIfPresent,
} from './node-entry-runtime-config.ts';

const host = { RIFTY_TEST_HOST: 'host-bootstrap' };
const variants = [
  { kind: 'program', bin: false, remoteFs: false, nodeServe: false },
  { kind: 'worker-thread', remoteFs: false, threadId: 1 },
] as const;
afterEach(() => publishKernelEntryBootstrap(null));

for (const variant of variants) {
  it(`v6 ${variant.kind} carries an immutable exact argv snapshot`, () => {
    const execArgv = ['--conditions', 'custom-condition'];
    const entry = buildNodeEntryWorkerEntry('https://host.test/node.js', host, {
      ...variant,
      execArgv,
    } as unknown as NodeEntryLaunch);
    expect(entry.bootstrap?.protocol).toBe('rifty.node-entry/v6');
    publishKernelEntryBootstrap(entry.bootstrap ?? null);
    execArgv.push('--caller-mutation');
    const launch = readNodeEntryBootstrap().launch as NodeEntryLaunch & {
      execArgv: readonly string[];
    };
    expect(launch.execArgv).toEqual(['--conditions', 'custom-condition']);
    expect(Object.isFrozen(launch.execArgv)).toBe(true);
  });
  it(`v6 ${variant.kind} requires own argv and keeps exact fields`, () => {
    const inherited = Object.assign(Object.create({ execArgv: [] }), variant);
    for (const launch of [
      variant,
      inherited,
      { ...variant, execArgv: undefined },
      { ...variant, execArgv: [3] },
    ]) {
      expect(() =>
        buildNodeEntryWorkerEntry('https://host.test/node.js', host, launch as NodeEntryLaunch),
      ).toThrow(/execArgv/);
    }
    expect(() =>
      buildNodeEntryWorkerEntry('https://host.test/node.js', host, {
        ...variant,
        execArgv: [],
        unvalidatedOptions: true,
      } as unknown as NodeEntryLaunch),
    ).toThrow(/unexpected field unvalidatedOptions/);
  });
}

it('never reads or falls back to a valid retired v5 launch', () => {
  publishKernelEntryBootstrap({
    protocol: 'rifty.node-entry/v5',
    payload: { hostRuntime: host, launch: variants[0] },
  });
  expect(readNodeEntryBootstrapIfPresent()).toBeNull();
  expect(() => readNodeEntryBootstrap()).toThrow(/protocol.*v6/);
});
