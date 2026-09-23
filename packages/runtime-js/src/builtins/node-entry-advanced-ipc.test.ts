import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  type NodeEntryLaunch,
  buildNodeEntryWorkerEntry,
  readNodeEntryBootstrap,
} from './node-entry-runtime-config.ts';

const hostRuntime = { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' };
const launch = {
  kind: 'program',
  execArgv: [],
  bin: false,
  remoteFs: true,
  nodeServe: true,
  ipc: 'advanced',
};

describe('advanced public IPC launch ownership', () => {
  afterEach(() => publishKernelEntryBootstrap(null));

  it('atomically versions the extended launch discriminator', () => {
    expect(NODE_ENTRY_BOOTSTRAP_PROTOCOL).toBe('rifty.node-entry/v6');
  });

  it('validates and preserves advanced mode at the producer', () => {
    // Exercise the runtime boundary before its public type admits the new mode.
    const entry = buildNodeEntryWorkerEntry(
      'https://host.test/node.js',
      hostRuntime,
      launch as unknown as NodeEntryLaunch,
    );
    expect(entry.bootstrap?.payload).toEqual({ hostRuntime, launch });
  });

  it('validates and preserves advanced mode at the receiving owner', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: { hostRuntime, launch },
    });
    expect(readNodeEntryBootstrap()).toEqual({ hostRuntime, launch });
  });

  it('rejects the old v4 envelope rather than silently selecting JSON', () => {
    publishKernelEntryBootstrap({
      protocol: 'rifty.node-entry/v4',
      payload: { hostRuntime, launch: { ...launch, ipc: 'json' } },
    });
    expect(() => readNodeEntryBootstrap()).toThrow('protocol mismatch');
  });
});
