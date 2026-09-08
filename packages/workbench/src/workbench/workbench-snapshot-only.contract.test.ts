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
    packageAcquisition: { registryUrl: '/npm-registry' },
    storage: { persistence: 'ephemeral' },
  };
}

describe('snapshot-only Workbench admission (I3)', () => {
  it('admits omitted registryUrl and Eddy as snapshot-only', () => {
    const admitted = validateWorkbenchOptions(
      { ...options(), packageAcquisition: {} },
      URL_CONTEXT,
    );
    expect(admitted.owner.packageAcquisition).not.toHaveProperty('registryUrl');
    expect(admitted.owner.packageAcquisition).not.toHaveProperty('eddy');
  });

  it('rejects Eddy when registryUrl is omitted', () => {
    expect(() =>
      validateWorkbenchOptions(
        {
          ...options(),
          packageAcquisition: {
            eddy: {
              resolverUrl: 'https://eddy.invalid/resolve',
              bundleBaseUrl: 'https://eddy.invalid/bundles',
              presetPins: { vite: '8.0.16' },
            },
          },
        },
        URL_CONTEXT,
      ),
    ).toThrow(/packageAcquisition\.(eddy|registryUrl)/);
  });

  it('admits a clone-safe initialize frame without registryUrl', () => {
    expect(() =>
      inspectPageToWorkbenchOwnerMessage({
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
          storage: { persistence: 'ephemeral' },
        },
      }),
    ).not.toThrow();
  });
});
