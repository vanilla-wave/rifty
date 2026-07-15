import { describe, expect, it } from 'vitest';
import { inspectProjectDefinition, projects } from '../workbench/project-definition.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';

describe('Workbench package config', () => {
  it('preserves the owner-revalidated manifest and binds only the owner-born root', () => {
    const definition = inspectProjectDefinition(
      projects.vite({
        id: 'config-a',
        files: {
          '/index.html': '<h1>A</h1>',
          '/package.json': JSON.stringify({
            name: 'guest-project',
            version: '1.2.3',
            dependencies: { kleur: '4.1.5' },
          }),
        },
        viteVersion: '8.0.16',
      }),
    );
    const expectedManifest = new TextDecoder().decode(definition.files['/package.json']);

    const config = workbenchPackageConfig(definition, '/owner/projects/config-a');

    expect(config).toMatchObject({
      templateId: 'config-a',
      slug: 'config-a',
      fromScratch: true,
      cfg: {
        runtime: 'vite',
        root: '/owner/projects/config-a',
        port: 5173,
        entryPath: '/owner/projects/config-a/index.html',
        packageName: 'guest-project',
        packageVersion: '1.2.3',
        installDeps: { kleur: '4.1.5' },
        seedFiles: {},
      },
    });
    expect(config.cfg.packageJson).toBe(expectedManifest);
  });

  it('rejects a page-shaped or non-normalized root before package acquisition', () => {
    const definition = inspectProjectDefinition(
      projects.vite({ id: 'config-b', files: { '/index.html': '<h1>B</h1>' } }),
    );

    expect(() => workbenchPackageConfig(definition, 'projects/config-b')).toThrow(/absolute/i);
    expect(() => workbenchPackageConfig(definition, '/projects/../config-b')).toThrow(
      /normalized/i,
    );
  });
});
