import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import type { NodeServerPackageConfig } from '../workbench/internal/project-package-config.ts';
import {
  DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL,
  buildDevServerChildEntry,
  readDevServerChildConfig,
  resolveDevServerChildConfig,
} from './dev-server-child-config.ts';
import type { NodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';

const CFG: NodeServerPackageConfig = {
  runtime: 'node-server',
  root: '/consumer-project',
  port: 4321,
  entryPath: '/consumer-project/server.mjs',
  packageName: 'external-consumer',
  packageVersion: '1.0.0',
  installDeps: { express: '5.1.0' },
  packageJson: '{"name":"external-consumer","version":"1.0.0"}\n',
  seedFiles: {
    '/consumer-project/server.mjs':
      "import http from 'node:http'; http.createServer((_req, res) => res.end('ok')).listen(4321)",
  },
};

const NODE_WORKER_RUNTIME: NodeWorkerRuntimeConfig = {
  kernelWorkerUrl: 'https://consumer.test/kernel.js',
  nodeEntryWorkerUrl: 'https://consumer.test/node.js',
  sqliteWasmUrl: 'https://consumer.test/sqlite.wasm',
};

const TERMINAL = {
  stdinIsTTY: false,
  stdoutIsTTY: true,
  stderrIsTTY: true,
  cols: 120,
  rows: 40,
} as const;

function envelope(
  input: {
    readonly cfg?: unknown;
    readonly nodeWorkerRuntime?: unknown;
    readonly terminal?: unknown;
    readonly previewScope?: unknown;
    readonly remoteFsRoot?: unknown;
  } = {},
): unknown {
  return {
    protocol: 'rifty.dev-server/v1',
    payload: {
      nodeWorkerRuntime: input.nodeWorkerRuntime ?? NODE_WORKER_RUNTIME,
      cfg: input.cfg ?? CFG,
      terminal: input.terminal ?? TERMINAL,
      ...(Object.prototype.hasOwnProperty.call(input, 'previewScope')
        ? { previewScope: input.previewScope }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'remoteFsRoot')
        ? { remoteFsRoot: input.remoteFsRoot }
        : {}),
    },
  };
}

afterEach(() => publishKernelEntryBootstrap(null));

describe('dev-server entry bootstrap', () => {
  it('accepts guest root only with a typed private remote-root binding', () => {
    const remoteFsRoot = '/.rifty/workbench/v1/projects/project-a/tree';
    const cfg = {
      ...CFG,
      root: '/',
      entryPath: '/server.mjs',
      seedFiles: { '/server.mjs': 'export {}' },
    };

    expect(resolveDevServerChildConfig(envelope({ cfg, remoteFsRoot }))).toMatchObject({
      cfg,
      remoteFsRoot,
    });
  });

  it('boots from the complete entry-scoped runtime config without an app template registry', () => {
    const resolved = resolveDevServerChildConfig(envelope({ previewScope: 'consumer-preview' }));

    expect(resolved).toEqual({
      nodeWorkerRuntime: NODE_WORKER_RUNTIME,
      cfg: CFG,
      terminal: TERMINAL,
      previewScope: 'consumer-preview',
    });
  });

  it('binds URL and detached config atomically and reads it through the kernel global', () => {
    const cfg = {
      ...CFG,
      installDeps: { ...CFG.installDeps },
      seedFiles: { ...CFG.seedFiles },
    };
    const nodeWorkerRuntime = { ...NODE_WORKER_RUNTIME };
    const terminal: {
      stdinIsTTY: boolean;
      stdoutIsTTY: boolean;
      stderrIsTTY: boolean;
      cols: number;
      rows: number;
    } = { ...TERMINAL };
    const entry = buildDevServerChildEntry('https://consumer.test/dev-server.js', {
      cfg,
      nodeWorkerRuntime,
      terminal,
      previewScope: 'scope-a',
    });

    cfg.installDeps.express = 'poisoned';
    cfg.seedFiles['/consumer-project/server.mjs'] = 'throw new Error("poisoned")';
    nodeWorkerRuntime.kernelWorkerUrl = 'https://poison.invalid/kernel.js';
    terminal.cols = 1;

    expect(entry).toMatchObject({
      kind: 'url',
      url: 'https://consumer.test/dev-server.js',
      bootstrap: { protocol: 'rifty.dev-server/v1' },
    });
    if (entry.bootstrap === undefined) throw new Error('dev-server entry lost its bootstrap');
    publishKernelEntryBootstrap(entry.bootstrap);
    const received = readDevServerChildConfig();
    expect(received).toEqual({
      cfg: CFG,
      nodeWorkerRuntime: NODE_WORKER_RUNTIME,
      terminal: TERMINAL,
      previewScope: 'scope-a',
    });
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen(received.cfg)).toBe(true);
    expect(Object.isFrozen(received.cfg.installDeps)).toBe(true);
    expect(Object.isFrozen(received.cfg.seedFiles)).toBe(true);
    expect(Object.isFrozen(received.nodeWorkerRuntime)).toBe(true);
    expect(Object.isFrozen(received.terminal)).toBe(true);
  });

  it('ignores inherited optional payload and package fields', () => {
    // Fault class: corrupt-input. Exact entry records snapshot own fields only;
    // prototype data cannot acquire preview or baked-package authority.
    const cfg = Object.assign(
      Object.create({
        bakedNodeModulesUrl: 'https://prototype.invalid/node_modules.tgz',
        bakedNodeModulesTemplateId: 'prototype-template',
      }),
      CFG,
    );
    const payload = Object.assign(Object.create({ previewScope: 'prototype-preview' }), {
      nodeWorkerRuntime: NODE_WORKER_RUNTIME,
      cfg,
      terminal: TERMINAL,
    });

    const resolved = resolveDevServerChildConfig({
      protocol: DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL,
      payload,
    });

    expect(resolved).toEqual({
      nodeWorkerRuntime: NODE_WORKER_RUNTIME,
      cfg: CFG,
      terminal: TERMINAL,
    });
    expect(Object.prototype.hasOwnProperty.call(resolved, 'previewScope')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolved.cfg, 'bakedNodeModulesUrl')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolved.cfg, 'bakedNodeModulesTemplateId')).toBe(
      false,
    );
  });

  it('rejects the legacy template-id env binding instead of re-resolving app policy', () => {
    expect(() =>
      resolveDevServerChildConfig({
        RIFTY_RFV_TEMPLATE: 'vite',
        RIFTY_RFV_ROOT: '/workspace',
        RIFTY_DEV_PORT: '5174',
      }),
    ).toThrow(/bootstrap/i);
  });

  it.each([
    ['missing envelope', null, /bootstrap/i],
    ['wrong protocol', { protocol: 'rifty.dev-server/v0', payload: {} }, /protocol/i],
    [
      'extra envelope field',
      { ...(envelope() as Record<string, unknown>), extra: true },
      /missing or unexpected fields/i,
    ],
    [
      'missing payload field',
      { protocol: 'rifty.dev-server/v1', payload: { cfg: CFG, terminal: TERMINAL } },
      /missing or unexpected fields/i,
    ],
    [
      'extra payload field',
      {
        protocol: 'rifty.dev-server/v1',
        payload: {
          nodeWorkerRuntime: NODE_WORKER_RUNTIME,
          cfg: CFG,
          terminal: TERMINAL,
          customRuntime: true,
        },
      },
      /missing or unexpected fields/i,
    ],
    [
      'extra runtime field',
      envelope({ nodeWorkerRuntime: { ...NODE_WORKER_RUNTIME, role: 'server' } }),
      /exactly/i,
    ],
    [
      'empty runtime URL',
      envelope({ nodeWorkerRuntime: { ...NODE_WORKER_RUNTIME, kernelWorkerUrl: '' } }),
      /non-empty/i,
    ],
    [
      'extra terminal field',
      envelope({ terminal: { ...TERMINAL, inheritedRole: 'vite' } }),
      /missing or unexpected fields/i,
    ],
    [
      'non-boolean terminal flag',
      envelope({ terminal: { ...TERMINAL, stdoutIsTTY: '1' } }),
      /boolean/i,
    ],
    ['zero terminal columns', envelope({ terminal: { ...TERMINAL, cols: 0 } }), /positive/i],
    ['wrong runtime kind', envelope({ cfg: { ...CFG, runtime: 'vite' } }), /node-server/i],
    ['zero port', envelope({ cfg: { ...CFG, port: 0 } }), /1 to 65535/i],
    ['oversized port', envelope({ cfg: { ...CFG, port: 65_536 } }), /1 to 65535/i],
    ['fractional port', envelope({ cfg: { ...CFG, port: 4321.5 } }), /1 to 65535/i],
    ['relative root', envelope({ cfg: { ...CFG, root: 'consumer-project' } }), /project root/i],
    [
      'non-normalized root',
      envelope({ cfg: { ...CFG, root: '/consumer/../consumer-project' } }),
      /project root/i,
    ],
    [
      'entry outside root',
      envelope({ cfg: { ...CFG, entryPath: '/other/server.mjs' } }),
      /inside cfg.root/i,
    ],
    [
      'seed outside root',
      envelope({ cfg: { ...CFG, seedFiles: { '/other/server.mjs': 'export {}' } } }),
      /inside cfg.root/i,
    ],
    ['malformed package json', envelope({ cfg: { ...CFG, packageJson: '{' } }), /valid JSON/i],
    [
      'empty dependency version',
      envelope({ cfg: { ...CFG, installDeps: { express: '' } } }),
      /non-empty/i,
    ],
    ['empty preview scope', envelope({ previewScope: '' }), /non-empty/i],
    [
      'extra cfg field',
      envelope({ cfg: { ...CFG, command: 'node server.mjs' } }),
      /missing or unexpected fields/i,
    ],
  ] as const)('rejects corrupt input: %s', (_name, value, message) => {
    expect(() => resolveDevServerChildConfig(value)).toThrow(message);
  });
});
