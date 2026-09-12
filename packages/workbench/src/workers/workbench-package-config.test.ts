import { describe, expect, it } from 'vitest';
import {
  defineNodeCliProject,
  defineNodeServerProject,
  defineNpmDevServerProject,
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

function currentManifest(definition: ReturnType<typeof inspectProjectDefinition>): Uint8Array {
  const bytes = definition.files['/package.json'];
  if (bytes === undefined) throw new Error('test definition omitted normalized /package.json');
  return bytes;
}

describe('Workbench package config', () => {
  it('reserves clean-start install preparation for install-first projects', () => {
    const definition = inspectProjectDefinition(
      projects.vite({ id: 'config-materialization', files: { '/index.html': '<h1>A</h1>' } }),
    );
    const instant = Object.freeze({
      ...definition,
      templateId: 'vite',
      firstMaterialization: Object.freeze({
        kind: 'snapshot' as const,
        snapshot: Object.freeze({
          snapshotId: `sha256:${'0'.repeat(64)}`,
          assetUrl: '/snapshot.json.gz',
          templateId: 'vite',
        }),
      }),
    });
    const fromScratch = Object.freeze({
      ...definition,
      templateId: 'vite',
      firstMaterialization: Object.freeze({ kind: 'install' as const }),
    });
    const options = { packageJsonBytes: currentManifest(definition) };

    expect(
      workbenchPackageConfig(instant, '/owner/projects/config-materialization', options)
        .fromScratch,
    ).toBe(false);
    expect(
      workbenchPackageConfig(fromScratch, '/owner/projects/config-materialization', options)
        .fromScratch,
    ).toBe(true);
  });

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

    const config = workbenchPackageConfig(definition, '/owner/projects/config-a', {
      packageJsonBytes: currentManifest(definition),
    });

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

  it('uses the current owner-tree manifest when reopening a user-extended project', () => {
    const definition = inspectProjectDefinition(
      projects.vite({
        id: 'config-reopen',
        files: { '/index.html': '<h1>Reopen</h1>' },
        dependencies: { vite: '8.0.16' },
      }),
    );
    const currentManifest = `${JSON.stringify({
      name: 'user-extended-project',
      version: '2.0.0',
      type: 'module',
      dependencies: { vite: '8.0.16', cowsay: '1.6.0' },
    })}\n`;

    const config = workbenchPackageConfig(definition, '/owner/projects/config-reopen', {
      packageJsonBytes: new TextEncoder().encode(currentManifest),
    });

    expect(config.cfg).toMatchObject({
      packageName: 'user-extended-project',
      packageVersion: '2.0.0',
      packageJson: currentManifest,
      installDeps: { vite: '8.0.16', cowsay: '1.6.0' },
    });
  });

  it('retains exact explicit node_modules seed bytes outside the runtime bootstrap config', () => {
    const binary = new Uint8Array([0, 255, 7, 128]);
    const definition = inspectProjectDefinition(
      projects.vite({
        id: 'config-template-node-modules',
        files: {
          '/index.html': '<h1>Typed fixture</h1>',
          '/src/main.ts': 'export {}\n',
          '/node_modules/@rifty/example-types/index.d.ts': 'declare const fixture: true;\n',
          '/node_modules/@rifty/example-types/fixture.bin': binary,
        },
      }),
    );

    const config = workbenchPackageConfig(
      definition,
      '/owner/projects/config-template-node-modules',
      { packageJsonBytes: currentManifest(definition) },
    );
    const seedFiles = Reflect.get(config, 'templateNodeModulesFiles') as unknown;

    expect(config.cfg.seedFiles).toEqual({});
    expect(seedFiles).toEqual({
      '/owner/projects/config-template-node-modules/node_modules/@rifty/example-types/index.d.ts':
        new TextEncoder().encode('declare const fixture: true;\n'),
      '/owner/projects/config-template-node-modules/node_modules/@rifty/example-types/fixture.bin':
        binary,
    });
    expect(Object.isFrozen(seedFiles)).toBe(true);
    expect(Reflect.ownKeys(seedFiles as object)).not.toContain(
      '/owner/projects/config-template-node-modules/src/main.ts',
    );
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
      { packageJsonBytes: currentManifest(definition) },
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

    const options = { packageJsonBytes: currentManifest(definition) };
    expect(() => workbenchPackageConfig(definition, 'projects/config-b', options)).toThrow(
      /absolute/i,
    );
    expect(() => workbenchPackageConfig(definition, '/projects/../config-b', options)).toThrow(
      /normalized/i,
    );
  });

  it('maps finite Node metadata into exact owner-rooted package configs', () => {
    const files = { '/src/main.mjs': 'console.log("node");\n' };
    const serverDefinition = inspectProjectDefinition(
      defineNodeServerProject({
        id: 'config-server',
        files,
        entryPath: '/src/main.mjs',
        port: 4321,
      }),
    );
    const server = workbenchPackageConfig(serverDefinition, '/owner/projects/config-server', {
      packageJsonBytes: currentManifest(serverDefinition),
    });
    const cliDefinition = inspectProjectDefinition(
      defineNodeCliProject({
        id: 'config-cli',
        files,
        entryPath: '/src/main.mjs',
        args: ['--format', 'json'],
      }),
    );
    const cli = workbenchPackageConfig(cliDefinition, '/owner/projects/config-cli', {
      packageJsonBytes: currentManifest(cliDefinition),
    });

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

  it('maps npm-owned dev servers without inventing entry or port coordinates', () => {
    const definition = inspectProjectDefinition(
      defineNpmDevServerProject({
        id: 'config-npm-dev-server',
        files: {
          '/package.json': `${JSON.stringify({
            name: 'ordinary-webpack-project',
            version: '1.0.0',
            scripts: { dev: 'webpack serve' },
            devDependencies: { webpack: '5.101.0', 'webpack-dev-server': '5.2.2' },
          })}\n`,
          '/webpack.config.js': 'module.exports = {};\n',
        },
      }),
    );
    const config = workbenchPackageConfig(definition, '/owner/projects/config-npm-dev-server', {
      packageJsonBytes: currentManifest(definition),
    });

    expect(config.cfg).toMatchObject({
      runtime: 'npm-dev-server',
      root: '/owner/projects/config-npm-dev-server',
      packageName: 'ordinary-webpack-project',
      packageVersion: '1.0.0',
      seedFiles: {},
    });
    expect(Reflect.ownKeys(config.cfg).sort()).toEqual([
      'installDeps',
      'packageJson',
      'packageName',
      'packageVersion',
      'root',
      'runtime',
      'seedFiles',
    ]);
    expect(config.cfg.packageJson).toContain('webpack serve');
  });
});
