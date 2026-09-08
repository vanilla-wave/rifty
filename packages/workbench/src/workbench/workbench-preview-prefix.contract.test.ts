import { describe, expect, it } from 'vitest';
import {
  type WorkbenchOptions,
  validateUrlContext,
  validateWorkbenchOptions,
} from './internal/workbench-options.ts';

const ROOT_CONTEXT = validateUrlContext({
  apiBaseUrl: 'https://workbench.invalid/app/index.html',
  clientUrl: 'https://workbench.invalid/app/index.html',
});

const SANDBOX_CONTEXT = validateUrlContext({
  apiBaseUrl: 'https://workbench.invalid/sandbox/index.html',
  clientUrl: 'https://workbench.invalid/sandbox/index.html',
});

function options(scope: string): WorkbenchOptions {
  return {
    deployment: {
      workers: {
        owner: '/assets/owner.js',
        kernel: '/assets/kernel.js',
        node: '/assets/node.js',
        devServer: '/assets/dev-server.js',
      },
      serviceWorker: { url: '/service-worker.js', scope },
      wasm: { sqlite: '/assets/sqlite.wasm' },
      previewProbeTimeoutMs: 50,
    },
    packageAcquisition: {},
    storage: { persistence: 'required' },
  };
}

describe('Workbench preview prefix admission (I5)', () => {
  it('admits deployment.previewPrefix when the SW scope contains it', () => {
    const withPrefix = {
      ...options('/sandbox/'),
      deployment: {
        ...options('/sandbox/').deployment,
        previewPrefix: '/sandbox/preview',
      },
    };
    const admitted = validateWorkbenchOptions(withPrefix, SANDBOX_CONTEXT) as {
      readonly previewPrefix?: string;
      readonly owner: { readonly deployment: { readonly previewPrefix?: string } };
    };
    expect(admitted.previewPrefix ?? admitted.owner.deployment.previewPrefix).toBe(
      '/sandbox/preview',
    );

    const rootScoped = {
      ...options('/'),
      deployment: {
        ...options('/').deployment,
        previewPrefix: '/sandbox/preview',
      },
    };
    const rootAdmitted = validateWorkbenchOptions(rootScoped, ROOT_CONTEXT) as {
      readonly previewPrefix?: string;
      readonly owner: { readonly deployment: { readonly previewPrefix?: string } };
    };
    expect(rootAdmitted.previewPrefix ?? rootAdmitted.owner.deployment.previewPrefix).toBe(
      '/sandbox/preview',
    );
  });
});
