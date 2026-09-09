import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { HOST_PREVIEW_ORIGIN, createPreviewRegistry } from '../workers/preview-registry.ts';
import { inspectPageToWorkbenchOwnerMessage } from './owner-protocol.ts';

const prefix = '/sandbox/p/';

describe('I5 preview configuration reaches all owner URL producers', () => {
  it('dev, production and Node URLs share the captured prefix, independent of run scope', () => {
    const sent: OwnerToPageFrame[] = [];
    const deps = { send: (frame: OwnerToPageFrame) => sent.push(frame), previewPrefix: prefix };
    const registry = createPreviewRegistry(deps);
    registry.setDevServer(5173, 'dev-run', { origin: HOST_PREVIEW_ORIGIN });
    registry.setPreview('build-run', [4173], 'production-run', HOST_PREVIEW_ORIGIN);
    registry.addNode('node-run', [3000], 'node-scope', { pid: 2, origin: HOST_PREVIEW_ORIGIN });
    const frames = sent.filter((frame) => frame.type === 'pty:preview');
    expect(
      frames.at(-1)?.ports.map(({ port, url, previewScope }) => ({ port, url, previewScope })),
    ).toEqual([
      { port: 5173, url: `${prefix}5173/`, previewScope: 'dev-run' },
      { port: 4173, url: `${prefix}4173/`, previewScope: 'production-run' },
      { port: 3000, url: `${prefix}3000/`, previewScope: 'node-scope' },
    ]);
    expect(sent.filter((frame) => frame.type === 'pty:dev-server').at(-1)).toMatchObject({
      port: 5173,
      url: `${prefix}5173/`,
      previewScope: 'dev-run',
    });
    registry.clearDevServer();
    expect(sent.filter((frame) => frame.type === 'pty:dev-server').at(-1)).toMatchObject({
      port: 4173,
      url: `${prefix}4173/`,
      previewScope: 'production-run',
    });
    registry.clearPreview('build-run');
    expect(sent.filter((frame) => frame.type === 'pty:dev-server').at(-1)).toMatchObject({
      port: 3000,
      url: `${prefix}3000/`,
      previewScope: 'node-scope',
    });
    registry.close();
    expect(sent.filter((frame) => frame.type === 'pty:preview').at(-1)).toEqual({
      type: 'pty:preview',
      ports: [],
    });
  });

  it('the exact owner boot frame preserves and freezes canonical prefix', () => {
    const config = {
      deployment: {
        workers: { kernel: '/kernel.js', node: '/node.js', devServer: '/dev.js' },
        wasm: { sqlite: '/sql.wasm' },
        previewProbeTimeoutMs: 3000,
        previewPrefix: prefix,
      },
      packageAcquisition: { mode: 'snapshot-only' },
      storage: { persistence: 'ephemeral' },
    };
    const decoded = inspectPageToWorkbenchOwnerMessage({ type: 'workbench:initialize', config });
    expect(decoded.type).toBe('workbench:initialize');
    if (decoded.type !== 'workbench:initialize') throw new Error('Wrong boot frame');
    expect(decoded.config.deployment).toMatchObject({ previewPrefix: prefix });
    expect(Object.isFrozen(decoded.config.deployment)).toBe(true);
    config.deployment.previewPrefix = '/changed/';
    expect(decoded.config.deployment).toMatchObject({ previewPrefix: prefix });
    expect(() =>
      inspectPageToWorkbenchOwnerMessage({
        type: 'workbench:initialize',
        config: {
          ...config,
          deployment: { ...config.deployment, previewPrefix: '/sandbox/../outside' },
        },
      }),
    ).toThrow();
  });
});
