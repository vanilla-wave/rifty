import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWorkbenchConfig } from './config.ts';
import type { ViteProjectSpec } from './project-spec.ts';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
});

const template: ViteProjectSpec = {
  id: 'vite',
  displayName: 'Vite',
  runtime: 'vite',
  runtimeSpecifier: 'vite',
  install: {},
  entry: { relativePath: '/src/main.js', content: '' },
  defaultPort: 5174,
  estimatedBootSeconds: 1,
  htmlTitle: 'App',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: false,
    allowedHosts: true,
  },
  hmr: { enabled: true },
};

function config() {
  return {
    assets: {
      ownerWorkerUrl: '/owner.js',
      kernelWorkerUrl: '/kernel.js',
      nodeWorkerUrl: '/node.js',
      devServerWorkerUrl: '/dev.js',
      serviceWorkerUrl: '/sw.js',
      sqliteWasmUrl: '/sqlite.wasm',
      esbuildWasmUrl: '/esbuild.wasm',
    },
    registry: { registryUrl: '/registry' },
    project: {
      catalog: {
        defaultTemplateId: 'vite',
        defaultStarterId: 'starter',
        templates: [template],
        starters: [
          {
            id: 'starter',
            name: 'Starter',
            templateId: 'vite',
            files: [{ path: 'src/main.js', content: 'hello' }],
          },
        ],
      },
    },
  };
}

describe('workbench config', () => {
  it('throws on SSR/Node construction', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('location', { href: 'https://host.test/' });
    expect(() => resolveWorkbenchConfig(config())).toThrow(/browser-only/);
  });

  it('requires explicit valid registry config before boot', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('location', { href: 'https://host.test/app/' });
    expect(() => resolveWorkbenchConfig({ ...config(), registry: { registryUrl: '' } })).toThrow(
      /registryUrl is required/,
    );
  });

  it('rejects omitted assets instead of coercing undefined into a relative URL', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('location', { href: 'https://host.test/app/' });
    const { ownerWorkerUrl: _omitted, ...assets } = config().assets;
    expect(() => resolveWorkbenchConfig({ ...config(), assets } as never)).toThrow(
      /assets\.ownerWorkerUrl is required/,
    );
  });

  it('validates every non-URL host field at the same construction boundary', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('location', { href: 'https://host.test/app/' });

    expect(() =>
      resolveWorkbenchConfig({
        ...config(),
        project: { ...config().project, root: 'relative' },
      }),
    ).toThrow(/project\.root/);
    for (const reservedRoot of ['/', '/.rifty', '/.rifty/nested']) {
      expect(() =>
        resolveWorkbenchConfig({
          ...config(),
          project: { ...config().project, root: reservedRoot },
        }),
      ).toThrow(/project\.root.*reserved/);
    }
    expect(() =>
      resolveWorkbenchConfig({
        ...config(),
        project: { ...config().project, setup: 'fast' as never },
      }),
    ).toThrow(/project\.setup/);
    for (const invalidWorkspaceId of ['', '\0', '\ud800']) {
      expect(() =>
        resolveWorkbenchConfig({
          ...config(),
          project: { ...config().project, workspaceId: invalidWorkspaceId },
        }),
      ).toThrow(/project\.workspaceId/);
    }
    expect(() =>
      resolveWorkbenchConfig({ ...config(), serviceWorkerScope: 'https://other.test/' }),
    ).toThrow(/serviceWorkerScope.*same-origin/);
    expect(() => resolveWorkbenchConfig({ ...config(), serviceWorkerScope: '/outside/' })).toThrow(
      /serviceWorkerScope.*current page/,
    );
    expect(() => resolveWorkbenchConfig({ ...config(), previewProbeTimeoutMs: 0 })).toThrow(
      /previewProbeTimeoutMs/,
    );
    expect(() =>
      resolveWorkbenchConfig({
        ...config(),
        registry: { registryUrl: '/registry', resolverPins: { vite: 42 as never } },
      }),
    ).toThrow(/resolverPins\.vite/);
  });

  it('resolves every host asset and project overlay without a bundler global', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('location', { href: 'https://host.test/app/' });
    const base = config();
    const baseStarter = base.project.catalog.starters[0];
    if (!baseStarter) throw new Error('test starter missing');
    const resolved = resolveWorkbenchConfig({
      ...base,
      project: {
        ...base.project,
        catalog: {
          ...base.project.catalog,
          starters: [
            {
              ...baseStarter,
              files: [...baseStarter.files, { path: 'README.md', content: 'keep me' }],
            },
          ],
        },
        files: [{ path: 'src/main.js', content: 'from host' }],
      },
    });

    expect(resolved.assets.ownerWorkerUrl).toBe('https://host.test/owner.js');
    expect(resolved.registry.registryUrl).toBe('https://host.test/registry');
    expect(resolved.project.catalog.starters[0]?.files).toEqual([
      { path: 'src/main.js', content: 'from host' },
      { path: 'README.md', content: 'keep me' },
    ]);
  });
});
