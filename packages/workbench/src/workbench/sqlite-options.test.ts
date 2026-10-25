import { describe, expect, it } from 'vitest';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';

const context = validateUrlContext({
  apiBaseUrl: 'https://consumer.test/',
  clientUrl: 'https://consumer.test/',
});

function options(wasm: unknown) {
  return {
    deployment: {
      workers: { owner: '/owner.js', kernel: '/kernel.js', node: '/node.js', devServer: '/dev.js' },
      serviceWorker: { url: '/sw.js', scope: '/' },
      ...(wasm === undefined ? {} : { wasm }),
    },
    packageAcquisition: { mode: 'snapshot-only' },
    storage: { persistence: 'ephemeral' },
  };
}

describe('Workbench optional SQLite asset', () => {
  it.each([undefined, {}, { sqlite: undefined }])(
    'accepts omitted SQLite configuration: %j',
    (wasm) => {
      expect(() => validateWorkbenchOptions(options(wasm), context)).not.toThrow();
    },
  );

  it.each([null, '', ' ', 42, 'http://[', 'ftp://consumer.test/sqlite.wasm'])(
    'rejects a supplied invalid SQLite URL: %j',
    (sqlite) => {
      expect(() => validateWorkbenchOptions(options({ sqlite }), context)).toThrow(
        /deployment\.wasm\.sqlite/,
      );
    },
  );

  it.each([null, [], ''])('rejects malformed wasm object: %j', (wasm) => {
    expect(() => validateWorkbenchOptions(options(wasm), context)).toThrow(/deployment\.wasm/);
  });
});
