import { afterEach, describe, expect, it, vi } from 'vitest';
import { type NodeServerProjectSpec, resolveBootstrapConfig } from '../templates/project-spec.ts';
import { createNodeServerRunner } from './node-server-runner.ts';

const DIRECT_SPEC: NodeServerProjectSpec = {
  id: 'bu-node-server',
  displayName: 'browser-unit node server',
  runtime: 'node-server',
  install: {},
  entry: { relativePath: '/src/server.js', content: '' },
  defaultPort: 4474,
  estimatedBootSeconds: 0,
  extraFiles: {},
};

const NODEMON_SPEC: NodeServerProjectSpec = {
  ...DIRECT_SPEC,
  id: 'bu-node-server-nodemon',
  devRunner: 'nodemon',
  devDependencies: { nodemon: '3.1.14' },
};

const realConsole = globalThis.console;
const realArgv = [...globalThis.process.argv];
const realServeEnv = globalThis.process.env.RIFTY_NODE_SERVE;

afterEach(() => {
  globalThis.console = realConsole;
  globalThis.process.argv = [...realArgv];
  if (realServeEnv === undefined)
    Reflect.deleteProperty(globalThis.process.env, 'RIFTY_NODE_SERVE');
  else globalThis.process.env.RIFTY_NODE_SERVE = realServeEnv;
});

describe('node-server runner', () => {
  it('launches the installed real nodemon bin and waits for its cross-realm app child', async () => {
    const root = '/bu-devboot/nodemon';
    const cfg = resolveBootstrapConfig(NODEMON_SPEC, 4473, root);
    if (cfg.runtime !== 'node-server') throw new Error('expected node-server config');
    const importEntry = vi.fn(async () => {});
    const runNodeBin = vi.fn(async () => {});
    const waitForLocalPort = vi.fn(async () => {});
    const waitForCrossRealmPort = vi.fn(async () => {});
    const run = createNodeServerRunner({
      importEntry,
      runNodeBin,
      waitForLocalPort,
      waitForCrossRealmPort,
    });

    const result = await run({ cfg, spec: NODEMON_SPEC, log: () => {} });

    expect(importEntry).not.toHaveBeenCalled();
    expect(waitForLocalPort).not.toHaveBeenCalled();
    expect(runNodeBin).toHaveBeenCalledWith({
      entryPath: `${root}/node_modules/.bin/nodemon`,
      cwd: root,
      argv: [
        'rifty',
        `${root}/node_modules/.bin/nodemon`,
        '--legacy-watch',
        '--no-stdin',
        '--no-update-notifier',
        'src/server.js',
      ],
      env: { RIFTY_NODE_SERVE: '1' },
    });
    expect(waitForCrossRealmPort).toHaveBeenCalledWith(4473, 10_000);
    expect(result.appChildOwnsPreviewBridge).toBe(true);
  });

  it('keeps direct node servers on the local import/listen gate', async () => {
    const root = '/bu-devboot/direct';
    const cfg = resolveBootstrapConfig(DIRECT_SPEC, 4474, root);
    if (cfg.runtime !== 'node-server') throw new Error('expected node-server config');
    const importEntry = vi.fn(async () => {});
    const runNodeBin = vi.fn(async () => {});
    const waitForLocalPort = vi.fn(async () => {});
    const waitForCrossRealmPort = vi.fn(async () => {});
    const run = createNodeServerRunner({
      importEntry,
      runNodeBin,
      waitForLocalPort,
      waitForCrossRealmPort,
    });

    const result = await run({ cfg, spec: DIRECT_SPEC, log: () => {} });

    expect(importEntry).toHaveBeenCalledWith(cfg.entryPath, `${root}/__entry__.mjs`);
    expect(waitForLocalPort).toHaveBeenCalledWith(4474, 10_000);
    expect(runNodeBin).not.toHaveBeenCalled();
    expect(waitForCrossRealmPort).not.toHaveBeenCalled();
    expect(result.appChildOwnsPreviewBridge).toBe(false);
  });

  it('propagates the real loader failure when the installed nodemon bin is missing', async () => {
    const root = '/bu-devboot/missing-nodemon';
    const cfg = resolveBootstrapConfig(NODEMON_SPEC, 4475, root);
    if (cfg.runtime !== 'node-server') throw new Error('expected node-server config');
    const importEntry = vi.fn(async () => {});
    const waitForCrossRealmPort = vi.fn(async () => {});
    const run = createNodeServerRunner({ importEntry, waitForCrossRealmPort });

    await expect(run({ cfg, spec: NODEMON_SPEC, log: () => {} })).rejects.toThrow(
      /node_modules\/\.bin\/nodemon/,
    );

    expect(importEntry).not.toHaveBeenCalled();
    expect(waitForCrossRealmPort).not.toHaveBeenCalled();
  });
});
