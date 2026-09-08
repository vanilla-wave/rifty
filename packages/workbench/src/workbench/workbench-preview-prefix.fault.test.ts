import { describe, expect, it } from 'vitest';
import {
  type WorkbenchOptions,
  validateUrlContext,
  validateWorkbenchOptions,
} from './internal/workbench-options.ts';

const SANDBOX_CONTEXT = validateUrlContext({
  apiBaseUrl: 'https://workbench.invalid/sandbox/index.html',
  clientUrl: 'https://workbench.invalid/sandbox/index.html',
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
      serviceWorker: { url: '/service-worker.js', scope: '/sandbox/' },
      wasm: { sqlite: '/assets/sqlite.wasm' },
    },
    packageAcquisition: {},
    storage: { persistence: 'required' },
  };
}

function withPrefix(previewPrefix: string): unknown {
  return {
    ...options(),
    deployment: {
      ...options().deployment,
      previewPrefix,
    },
  };
}

describe('Workbench preview prefix faults (I5)', () => {
  it.each(['', 'preview', '/sandbox/preview/', '//x', '/a/../b', '/a//b', '\\x'])(
    'rejects invalid deployment.previewPrefix %j before SW register',
    (previewPrefix) => {
      expect(() => validateWorkbenchOptions(withPrefix(previewPrefix), SANDBOX_CONTEXT)).toThrow(
        TypeError,
      );
      expect(() => validateWorkbenchOptions(withPrefix(previewPrefix), SANDBOX_CONTEXT)).toThrow(
        /deployment\.previewPrefix/,
      );
    },
  );

  it('rejects a prefix outside the SW scope before SW register', () => {
    expect(() => validateWorkbenchOptions(withPrefix('/preview'), SANDBOX_CONTEXT)).toThrow(
      TypeError,
    );
    expect(() => validateWorkbenchOptions(withPrefix('/preview'), SANDBOX_CONTEXT)).toThrow(
      /deployment\.previewPrefix/,
    );
  });
});
