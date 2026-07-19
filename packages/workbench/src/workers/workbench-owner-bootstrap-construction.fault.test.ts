import { describe, expect, it } from 'vitest';
import type {
  PageToWorkbenchOwnerMessage,
  WorkbenchOwnerBootConfig,
} from '../workbench/owner-protocol.ts';
import { runWorkbenchOwner } from './workbench-owner-runtime.ts';
import type { KernelIpc } from './worker-runtime-globals.ts';

const config: WorkbenchOwnerBootConfig = Object.freeze({
  deployment: Object.freeze({
    workers: Object.freeze({
      kernel: '/kernel.js',
      node: '/node.js',
      devServer: '/dev-server.js',
      typescript: '/typescript.js',
    }),
    wasm: Object.freeze({ sqlite: '/sqlite.wasm' }),
    previewProbeTimeoutMs: 1_000,
  }),
  packageAcquisition: Object.freeze({ registryUrl: '/registry' }),
  storage: Object.freeze({ persistence: 'ephemeral' }),
});

const companionConfig: WorkbenchOwnerBootConfig = Object.freeze({
  ...config,
  legacyWorkspacePrefix: '/workspaces/legacy',
  playgroundUrlContext: Object.freeze({
    apiBaseUrl: 'https://playground.invalid/app/',
    clientUrl: 'https://playground.invalid/app/index.html',
  }),
});

function initialize(ownerConfig: WorkbenchOwnerBootConfig): PageToWorkbenchOwnerMessage {
  return { type: 'workbench:initialize', config: ownerConfig };
}

function ipcHarness(
  inbound: readonly PageToWorkbenchOwnerMessage[],
  send: (message: unknown) => void,
): KernelIpc {
  return Object.freeze({
    onMessage(handler: (message: unknown) => void) {
      for (const message of inbound) handler(message);
    },
    send,
  });
}

describe('torn-state: real Workbench owner construction', () => {
  it.each([
    ['core', config],
    ['companion', companionConfig],
  ] as const)(
    'constructs and closes the real ephemeral %s owner when shutdown was queued at boot',
    async (_mode, ownerConfig) => {
      const outbound: unknown[] = [];

      await runWorkbenchOwner(
        ipcHarness([initialize(ownerConfig), { type: 'workbench:shutdown' }], (message) => {
          outbound.push(message);
        }),
      );

      expect(outbound).toEqual([]);
    },
  );

  it.each([
    ['core', config, 'workbench:owner-ready'],
    ['companion', companionConfig, 'workbench:playground-ready'],
  ] as const)(
    'rolls back the full real %s ownership graph when the external ready reply fails',
    async (_mode, ownerConfig, expectedReply) => {
      const replyFailure = new Error('owner reply port closed');
      const outbound: unknown[] = [];

      const failure = await runWorkbenchOwner(
        ipcHarness([initialize(ownerConfig)], (message) => {
          outbound.push(message);
          throw replyFailure;
        }),
      ).catch((error: unknown) => error);

      expect(failure).toBe(replyFailure);
      expect(outbound).toHaveLength(1);
      expect(outbound[0]).toMatchObject({ type: expectedReply });
      if (expectedReply === 'workbench:owner-ready') {
        expect(outbound[0]).toMatchObject({
          storage: {
            policy: 'ephemeral',
            backend: 'memory',
            durability: 'ephemeral',
          },
        });
      }
    },
  );
});
