import { describe, expect, it } from 'vitest';
import { validateWorkbenchOptions } from './internal/workbench-options.ts';
import { inspectPageToWorkbenchOwnerMessage } from './owner-protocol.ts';

const POLICIES = ['required', 'preferred', 'ephemeral'] as const;
const INVALID = ['', ' \t ', '\0', '/', 'a/b', 'a\\b', '.', '..', null, 42, [], {}];
const context = {
  apiBaseUrl: new URL('https://workbench.invalid/app/index.html'),
  clientUrl: new URL('https://workbench.invalid/app/index.html'),
};
function options(persistence: string, namespace?: unknown) {
  return {
    deployment: {
      workers: { owner: '/owner.js', kernel: '/kernel.js', node: '/node.js', devServer: '/dev.js' },
      serviceWorker: { url: '/sw.js', scope: '/' },
      wasm: { sqlite: '/sqlite.wasm' },
      previewProbeTimeoutMs: 100,
    },
    packageAcquisition: { mode: 'registry', registryUrl: '/npm-registry' },
    storage: { persistence, ...(namespace === undefined ? {} : { namespace }) },
  };
}
function frame(persistence: string, namespace?: unknown) {
  const input = options(persistence, namespace);
  return {
    type: 'workbench:initialize',
    config: {
      deployment: {
        workers: { kernel: '/kernel.js', node: '/node.js', devServer: '/dev.js' },
        wasm: input.deployment.wasm,
        previewProbeTimeoutMs: 100,
      },
      packageAcquisition: { mode: 'registry', registryUrl: '/npm-registry' },
      storage: input.storage,
    },
  };
}

describe('host-selected Workbench OPFS namespace', () => {
  it.each(['scope-A', ' scope-A '])(
    'preserves literal namespace %j for every persistence policy',
    (namespace) => {
      for (const policy of POLICIES) {
        const normalized = validateWorkbenchOptions(options(policy, namespace), context);
        expect
          .soft(JSON.stringify(normalized))
          .toContain(`"namespace":${JSON.stringify(namespace)}`);
      }
    },
  );
  it.each(INVALID.map((value) => [value]))(
    'rejects invalid namespace %j before effects, including preferred/ephemeral',
    (namespace) => {
      for (const policy of POLICIES) {
        expect.soft(() => validateWorkbenchOptions(options(policy, namespace), context)).toThrow();
      }
    },
  );
  it('keeps namespace omitted for every legacy policy', () => {
    for (const policy of POLICIES) {
      const normalized = validateWorkbenchOptions(options(policy), context);
      expect(JSON.stringify(normalized)).not.toContain('"namespace"');
      expect(JSON.stringify(normalized)).toContain(policy);
    }
  });
  it.each(['scope-A', ' scope-A '])(
    'owner wire carries literal namespace %j unchanged',
    (namespace) => {
      for (const policy of POLICIES) {
        const decoded = inspectPageToWorkbenchOwnerMessage(frame(policy, namespace));
        expect(decoded).toMatchObject({
          type: 'workbench:initialize',
          config: { storage: { persistence: policy, namespace } },
        });
      }
    },
  );
  it.each(INVALID.map((value) => [value]))(
    'owner wire rejects invalid namespace %j',
    (namespace) => {
      for (const policy of POLICIES) {
        expect(() => inspectPageToWorkbenchOwnerMessage(frame(policy, namespace))).toThrow();
      }
    },
  );
  it('retains legacy owner storage shape without namespace', () => {
    for (const policy of POLICIES) {
      const decoded = inspectPageToWorkbenchOwnerMessage(frame(policy));
      expect(decoded).toMatchObject({
        type: 'workbench:initialize',
        config: { storage: { persistence: policy } },
      });
      expect(JSON.stringify(decoded)).not.toContain('"namespace"');
    }
  });
});
