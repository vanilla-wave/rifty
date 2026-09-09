import { describe, expect, it } from 'vitest';
import {
  type WorkbenchOptions,
  validateUrlContext,
  validateWorkbenchOptions,
} from './internal/workbench-options.ts';

const CONTEXT = validateUrlContext({
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
    },
    packageAcquisition: {},
    storage: { persistence: 'required' },
  };
}

const INVALID = [0, -1, Number.POSITIVE_INFINITY, Number.NaN, '80'] as const;
const FIELDS = ['ownerStartupTimeoutMs', 'projectFileTimeoutMs', 'sessionToolsTimeoutMs'] as const;

describe('Workbench operation-budget faults (I7)', () => {
  it.each(FIELDS.flatMap((field) => INVALID.map((value) => ({ field, value }))))(
    'rejects invalid deployment.$field $value before owner start',
    ({ field, value }) => {
      const candidate = {
        ...options(),
        deployment: {
          ...options().deployment,
          [field]: value,
        },
      };
      expect(() => validateWorkbenchOptions(candidate, CONTEXT)).toThrow(TypeError);
      expect(() => validateWorkbenchOptions(candidate, CONTEXT)).toThrow(
        new RegExp(`deployment\\.${field}`),
      );
    },
  );
});
