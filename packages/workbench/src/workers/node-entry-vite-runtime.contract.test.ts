import { NotImplementedError } from '@riftydev/io';
import {
  type KernelEntryCapabilityPorts,
  publishKernelEntryCapabilityPorts,
} from '@riftydev/kernel';
import { SHADOW_ASSET_CAPABILITY, ShadowAssetReadError } from '@riftydev/npm-client';
import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViteCliPreparation } from './vite-cli-prep.ts';
import { prepareViteCliAcquisitionFiles } from './vite-cli-prep.ts';
import { viteConfigTempPatchPolicy } from './vite-config-temp-patch.ts';
import { consumeWorkbenchEntryCapabilities } from './workbench-entry-capabilities.ts';

const CLI_PATH = '/app/node_modules/vite/dist/node/cli.js';
const PACKAGE_PATH = '/app/node_modules/vite/package.json';
const VITE_PREPARATION: ViteCliPreparation = Object.freeze({
  root: '/app',
  mode: 'build',
  executedBinPath: '/app/node_modules/.bin/vite',
} as ViteCliPreparation);
const ESBUILD_ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';
const MODULE_PATH = './node-entry-vite-runtime.ts';

const CLI_SOURCE = [
  'class TestCac {',
  '  runMatchedCommand() { return Promise.resolve(); }',
  '  parse() { this.runMatchedCommand(); }',
  '}',
].join('\n');

const WATCH_SOURCE = [
  'const EMPTY_STR = "";',
  'const ONE_DOT = ".";',
  'const TWO_DOTS = "..";',
  'class TestDirEntry {',
  '  constructor() { this.items = new Set(); }',
  '  add(item) {',
  '    const { items } = this;',
  '    if (!items) return;',
  '    if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
  '  }',
  '}',
].join('\n');

interface NodeEntryViteRuntimeApi {
  readonly prepareViteCliForNodeEntry: (
    preparation: ViteCliPreparation,
    capabilities: KernelEntryCapabilityPorts,
  ) => Promise<void>;
}

async function api(): Promise<NodeEntryViteRuntimeApi> {
  return (await import(/* @vite-ignore */ MODULE_PATH)) as NodeEntryViteRuntimeApi;
}

async function bootVite(version: string): Promise<MemoryFsSync> {
  const configPolicy = viteConfigTempPatchPolicy.sources.find(
    (candidate) => candidate.version === version,
  );
  if (configPolicy === undefined) throw new Error(`missing Vite config policy for ${version}`);
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  fsSync.loadFixture({
    '/app/package.json': '{}',
    [CLI_PATH]: CLI_SOURCE,
    [`/app/node_modules/vite/${configPolicy.relativeSourcePath}`]: `${configPolicy.upstreamBlock}\n${WATCH_SOURCE}`,
    [PACKAGE_PATH]: JSON.stringify({ name: 'vite', version }),
  });
  await prepareViteCliAcquisitionFiles('/app');
  return fsSync;
}

function consumeCapabilities(ports: KernelEntryCapabilityPorts): KernelEntryCapabilityPorts {
  publishKernelEntryCapabilityPorts(ports);
  return consumeWorkbenchEntryCapabilities();
}

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.addEventListener('message', (event) => resolve(event.data), { once: true });
    port.start();
  });
}

afterEach(() => {
  publishKernelEntryCapabilityPorts(null);
  resetSyncMirror();
});

describe('node-entry Vite capability-only runtime', () => {
  it('prepares Vite 8 with the canonical empty capability set', async () => {
    await bootVite('8.0.16');

    await expect(
      (await api()).prepareViteCliForNodeEntry(VITE_PREPARATION, consumeCapabilities({})),
    ).resolves.toBeUndefined();
  });

  it('closes and loud-fails a supplied capability for Vite 8', async () => {
    await bootVite('8.0.16');
    const channel = new MessageChannel();
    const start = vi.spyOn(channel.port2, 'start');
    const post = vi.spyOn(channel.port2, 'postMessage');
    const close = vi.spyOn(channel.port2, 'close');
    try {
      await expect(
        (await api()).prepareViteCliForNodeEntry(
          VITE_PREPARATION,
          consumeCapabilities({ [SHADOW_ASSET_CAPABILITY]: channel.port2 }),
        ),
      ).rejects.toThrow('Vite without the esbuild runtime received an unexpected entry capability');
      expect(start).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      channel.port1.close();
    }
  });

  it.each(['dev', 'build', 'preview', 'optimize', 'info'] as const)(
    'loud-throws for Vite 7 %s before import when admission supplied no capability',
    async (mode) => {
      await bootVite('7.3.6');
      const capabilities = consumeCapabilities({});

      const failure = await (await api())
        .prepareViteCliForNodeEntry(
          {
            ...VITE_PREPARATION,
            mode,
          },
          capabilities,
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(NotImplementedError);
      expect(failure).toMatchObject({ feature: 'vite.esbuild.shadowAssets' });
    },
  );

  it('closes a consumed capability when Vite planning fails before runtime selection', async () => {
    await bootVite('7.3.6');
    const channel = new MessageChannel();
    const close = vi.spyOn(channel.port2, 'close');
    const capabilities = consumeCapabilities({ [SHADOW_ASSET_CAPABILITY]: channel.port2 });

    await expect(
      (await api()).prepareViteCliForNodeEntry(
        { ...VITE_PREPARATION, executedBinPath: '/not-an-installed-vite-entry' },
        capabilities,
      ),
    ).rejects.toThrow('vite CLI preparation expected an installed Vite entry');
    expect(close).toHaveBeenCalledTimes(1);
    channel.port1.close();
  });

  it('preserves a typed read failure and disposes the client exactly once after preparation', async () => {
    await bootVite('7.3.6');
    const channel = new MessageChannel();
    const capabilities = consumeCapabilities({ [SHADOW_ASSET_CAPABILITY]: channel.port2 });
    const first = nextMessage(channel.port1);
    const preparation = (await api()).prepareViteCliForNodeEntry(VITE_PREPARATION, capabilities);
    preparation.catch(() => {});
    try {
      const read = (await first) as { readonly requestId: number; readonly assetId: string };
      expect(read.assetId).toBe(ESBUILD_ASSET_ID);
      const disposed = nextMessage(channel.port1);
      channel.port1.postMessage({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: read.requestId,
        error: {
          name: 'ShadowAssetReadError',
          code: 'ESHADOWASSETREAD',
          message: 'contract wrong-plan failure',
          assetId: ESBUILD_ASSET_ID,
          reason: 'unknown-asset',
        },
      });

      await expect(preparation).rejects.toBeInstanceOf(ShadowAssetReadError);
      await expect(disposed).resolves.toEqual({
        protocol: 'rifty.shadow-assets/v1',
        type: 'dispose',
      });
      await expect(
        Promise.race([
          nextMessage(channel.port1),
          Promise.resolve().then(() => 'no-second-dispose'),
        ]),
      ).resolves.toBe('no-second-dispose');
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});
