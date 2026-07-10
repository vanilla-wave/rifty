import { afterEach, describe, expect, it, vi } from 'vitest';
import { type NodeServerProjectSpec, resolveBootstrapConfig } from '../templates/project-spec.ts';
import { createNodeServerRunner } from './node-server-runner.ts';

function createRequestFault() {
  const destroy = vi.fn();
  const httpGet = vi.fn((_url: string, _onResponse: (response: { resume(): unknown }) => void) => ({
    on: vi.fn().mockReturnThis(),
    destroy,
  }));
  return { destroy, httpGet };
}

const NODEMON_SPEC: NodeServerProjectSpec = {
  id: 'bu-node-server-nodemon-fault',
  displayName: 'browser-unit nodemon fault',
  runtime: 'node-server',
  install: {},
  entry: { relativePath: '/src/server.js', content: '' },
  defaultPort: 4476,
  estimatedBootSeconds: 0,
  extraFiles: {},
  devRunner: 'nodemon',
  devDependencies: { nodemon: '3.1.14' },
};

const realConsole = globalThis.console;

afterEach(() => {
  globalThis.console = realConsole;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('node-server runner faults', () => {
  it('destroys a stalled cross-realm probe so the outer readiness deadline advances', async () => {
    vi.useFakeTimers();
    const requestFault = createRequestFault();
    const root = '/bu-devboot/nodemon-stalled-probe';
    const cfg = resolveBootstrapConfig(NODEMON_SPEC, NODEMON_SPEC.defaultPort, root);
    if (cfg.runtime !== 'node-server') throw new Error('expected node-server config');
    const run = createNodeServerRunner({
      importEntry: vi.fn(async () => {}),
      runNodeBin: vi.fn(async () => {}),
      httpGet: requestFault.httpGet,
    });
    let settled = false;
    let failure: unknown;

    void run({ cfg, spec: NODEMON_SPEC, log: () => {} }).then(
      () => {
        settled = true;
      },
      (error: unknown) => {
        settled = true;
        failure = error;
      },
    );
    await vi.advanceTimersByTimeAsync(11_000);

    expect(settled).toBe(true);
    expect(failure).toEqual(
      new Error(
        `[real-vite/worker] nodemon app never served internal port ${cfg.port} within 10000ms`,
      ),
    );
    expect(requestFault.destroy).toHaveBeenCalled();
  });
});
