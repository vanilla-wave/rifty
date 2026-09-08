import { describe, expect, it } from 'vitest';
import {
  type WorkbenchOptions,
  validateUrlContext,
  validateWorkbenchOptions,
} from './internal/workbench-options.ts';
import { inspectPageToWorkbenchOwnerMessage } from './owner-protocol.ts';

const URL_CONTEXT = validateUrlContext({
  apiBaseUrl: 'https://workbench.invalid/app/index.html',
  clientUrl: 'https://workbench.invalid/app/index.html',
});

function options(): WorkbenchOptions {
  return {
    deployment: {
      workers: {
        owner: '/assets/owner.js',
        kernel: '/assets/kernel.js',
        node: '/assets/node.js',
        devServer: '/assets/dev-server.js',
      },
      serviceWorker: { url: '/service-worker.js', scope: '/' },
      wasm: { sqlite: '/assets/sqlite.wasm' },
      previewProbeTimeoutMs: 50,
    },
    packageAcquisition: {},
    storage: { persistence: 'required' },
  };
}

function initializeConfig(storage: Record<string, unknown>): unknown {
  return {
    type: 'workbench:initialize',
    config: {
      deployment: {
        workers: {
          kernel: 'https://workbench.invalid/kernel.js',
          node: 'https://workbench.invalid/node.js',
          devServer: 'https://workbench.invalid/dev-server.js',
        },
        wasm: { sqlite: 'https://workbench.invalid/sqlite.wasm' },
        previewProbeTimeoutMs: 3_000,
      },
      packageAcquisition: {},
      storage,
    },
  };
}

describe('Workbench storage namespace admission (I4)', () => {
  it('admits a clone-safe namespace on options and initialize', () => {
    const admitted = validateWorkbenchOptions(
      { ...options(), storage: { persistence: 'required', namespace: 'plugin-sandbox' } },
      URL_CONTEXT,
    );
    expect(admitted.storage).toEqual({
      persistence: 'required',
      namespace: 'plugin-sandbox',
    });

    const nested = validateWorkbenchOptions(
      { ...options(), storage: { persistence: 'required', namespace: 'tenant/plugin' } },
      URL_CONTEXT,
    );
    expect(nested.storage).toEqual({ persistence: 'required', namespace: 'tenant/plugin' });

    expect(() =>
      inspectPageToWorkbenchOwnerMessage(
        initializeConfig({ persistence: 'required', namespace: 'plugin-sandbox' }),
      ),
    ).not.toThrow();
  });

  it.each(['', '..', '.', '/abs', 'a/../b', 'a//b', 'a/', '\\abs', 'has space'])(
    'rejects invalid storage.namespace %j before owner start',
    (namespace) => {
      expect(() =>
        validateWorkbenchOptions(
          { ...options(), storage: { persistence: 'required', namespace } },
          URL_CONTEXT,
        ),
      ).toThrow(/storage\.namespace/);
      expect(() =>
        inspectPageToWorkbenchOwnerMessage(
          initializeConfig({ persistence: 'required', namespace }),
        ),
      ).toThrow(/storage\.namespace/);
    },
  );
});
