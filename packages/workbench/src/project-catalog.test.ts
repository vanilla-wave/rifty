import { describe, expect, it } from 'vitest';
import {
  parseProjectCatalog,
  resolveProjectSpec,
  resolveStarter,
  seedFilesForStarter,
  validateProjectCatalog,
} from './project-catalog.ts';
import type { NodeCliProjectSpec, ViteProjectSpec } from './project-spec.ts';

const template: ViteProjectSpec = {
  id: 'vite',
  displayName: 'Vite',
  runtime: 'vite',
  runtimeSpecifier: 'vite',
  install: { vite: '^7.0.0' },
  entry: { relativePath: '/src/main.js', content: 'template' },
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

const value = {
  defaultTemplateId: 'vite',
  defaultStarterId: 'hello',
  templates: [template],
  starters: [
    {
      id: 'hello',
      name: 'Hello',
      templateId: 'vite',
      files: [{ path: 'src/main.js', content: 'hello' }],
    },
  ],
};

describe('project catalog', () => {
  it('round-trips serializable project data and seeds the selected starter', () => {
    const catalog = parseProjectCatalog(JSON.stringify(value));

    expect(resolveProjectSpec(catalog).id).toBe('vite');
    expect(resolveStarter(catalog).id).toBe('hello');
    expect(seedFilesForStarter(catalog, resolveStarter(catalog), '/scratch')).toMatchObject({
      '/scratch/src/main.js': 'hello',
    });
  });

  it('rejects duplicate and dangling ids before a worker can boot', () => {
    expect(() => validateProjectCatalog({ ...value, templates: [template, template] })).toThrow(
      /duplicate template id/,
    );
    expect(() =>
      validateProjectCatalog({
        ...value,
        starters: [{ ...value.starters[0], templateId: 'missing' }],
      }),
    ).toThrow(/unknown template/);
  });

  it('accepts port zero only for a non-listening node-cli template', () => {
    const cli: NodeCliProjectSpec = {
      id: 'cli',
      displayName: 'CLI',
      runtime: 'node-cli',
      install: {},
      entry: { relativePath: '/src/cli.js', content: 'console.log(1)' },
      defaultPort: 0,
      estimatedBootSeconds: 0,
      extraFiles: {},
    };
    expect(
      validateProjectCatalog({
        defaultTemplateId: 'cli',
        defaultStarterId: 'cli-starter',
        templates: [cli],
        starters: [
          {
            id: 'cli-starter',
            name: 'CLI starter',
            templateId: 'cli',
            files: [{ path: 'src/cli.js', content: 'console.log(1)' }],
          },
        ],
      }).templates[0]?.defaultPort,
    ).toBe(0);
    expect(() =>
      validateProjectCatalog({ ...value, templates: [{ ...template, defaultPort: 0 }] }),
    ).toThrow(/defaultPort is invalid/);
  });

  it('rejects starter traversal and malformed template data before seeding the owner', () => {
    expect(() =>
      validateProjectCatalog({
        ...value,
        starters: [
          {
            ...value.starters[0],
            files: [{ path: '../outside.js', content: 'escape' }],
          },
        ],
      }),
    ).toThrow(/files\[0\]\.path.*root-relative/);
    expect(() =>
      validateProjectCatalog({
        ...value,
        templates: [{ ...template, install: { vite: 7 } }],
      }),
    ).toThrow(/install\.vite.*non-empty string/);
    expect(() =>
      validateProjectCatalog({
        ...value,
        templates: [{ ...template, entry: { ...template.entry, relativePath: 'src/main.js' } }],
      }),
    ).toThrow(/entry\.relativePath.*root-relative/);
  });
});
