import { describe, expect, it } from 'vitest';
import {
  defineNodeCliProject,
  defineNodeServerProject,
  inspectProjectDefinition,
  projects,
} from '../workbench/project-definition.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';

function prototypeKeyMap(version: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(`{"__proto__":${JSON.stringify(version)}}`);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('test dependency map is not an object');
  }
  return parsed as Readonly<Record<string, string>>;
}

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

  // Fault classes: corrupt-input + lossy-aggregate. Package acquisition must
  // receive the same own dependency keys carried by the normalized manifest.
  it('preserves prototype-colliding dependencies consistently in installDeps', () => {
    const definition = inspectProjectDefinition(
      projects.vite({
        id: 'config-prototype-dependency',
        files: { '/index.html': '<h1>Prototype dependency</h1>' },
        dependencies: prototypeKeyMap('1.2.3'),
      }),
    );
    const config = workbenchPackageConfig(
      definition,
      '/owner/projects/config-prototype-dependency',
    );
    const parsedManifest: unknown = JSON.parse(config.cfg.packageJson);
    if (
      parsedManifest === null ||
      typeof parsedManifest !== 'object' ||
      Array.isArray(parsedManifest)
    ) {
      throw new Error('normalized package.json is not an object');
    }
    const manifestDependencies = Reflect.get(parsedManifest, 'dependencies') as unknown;
    if (
      manifestDependencies === null ||
      typeof manifestDependencies !== 'object' ||
      Array.isArray(manifestDependencies)
    ) {
      throw new Error('normalized package.json dependencies is not an object');
    }

    expect.soft(Object.prototype.hasOwnProperty.call(manifestDependencies, '__proto__')).toBe(true);
    expect
      .soft(Object.prototype.hasOwnProperty.call(config.cfg.installDeps, '__proto__'))
      .toBe(true);
    expect
      .soft(Object.prototype.propertyIsEnumerable.call(config.cfg.installDeps, '__proto__'))
      .toBe(true);
    expect.soft(Object.keys(config.cfg.installDeps)).toEqual(Object.keys(manifestDependencies));
    expect
      .soft(Reflect.get(config.cfg.installDeps, '__proto__'))
      .toBe(Reflect.get(manifestDependencies, '__proto__'));
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

  it('maps finite Node metadata into exact owner-rooted package configs', () => {
    const files = { '/src/main.mjs': 'console.log("node");\n' };
    const server = workbenchPackageConfig(
      inspectProjectDefinition(
        defineNodeServerProject({
          id: 'config-server',
          files,
          entryPath: '/src/main.mjs',
          port: 4321,
        }),
      ),
      '/owner/projects/config-server',
    );
    const cli = workbenchPackageConfig(
      inspectProjectDefinition(
        defineNodeCliProject({
          id: 'config-cli',
          files,
          entryPath: '/src/main.mjs',
          args: ['--format', 'json'],
        }),
      ),
      '/owner/projects/config-cli',
    );

    expect(server.cfg).toMatchObject({
      runtime: 'node-server',
      root: '/owner/projects/config-server',
      port: 4321,
      entryPath: '/owner/projects/config-server/src/main.mjs',
    });
    expect(cli.cfg).toMatchObject({
      runtime: 'node-cli',
      root: '/owner/projects/config-cli',
      entryPath: '/owner/projects/config-cli/src/main.mjs',
    });
    expect('port' in cli.cfg).toBe(false);
  });
});
