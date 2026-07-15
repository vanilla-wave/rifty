import { describe, expect, it } from 'vitest';
import { inspectProjectDefinition, projects } from './project-definition.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

type Definition = ReturnType<typeof projects.vite>;
type DefinitionOptions = Parameters<typeof projects.vite>[0];
type DefinitionSnapshot = ReturnType<typeof inspectProjectDefinition>;

interface PackageManifest {
  readonly [field: string]: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

const VITE_VERSION_CONFLICTS = [
  [
    'manifest dependencies',
    { files: { '/package.json': JSON.stringify({ dependencies: { vite: '7.3.1' } }) } },
  ],
  [
    'manifest devDependencies',
    { files: { '/package.json': JSON.stringify({ devDependencies: { vite: '7.3.1' } }) } },
  ],
  ['dependencies option', { files: {}, dependencies: { vite: '7.3.1' } }],
  ['devDependencies option', { files: {}, devDependencies: { vite: '7.3.1' } }],
] satisfies ReadonlyArray<readonly [string, Omit<DefinitionOptions, 'id' | 'viteVersion'>]>;

const TWO_VITE_SECTIONS = [
  [
    'both option maps',
    {
      id: 'two-option-sections',
      files: {},
      dependencies: { vite: '7.3.1' },
      devDependencies: { vite: '8.0.16' },
    },
  ],
  [
    'manifest dependencies plus a devDependencies option',
    {
      id: 'manifest-and-option-sections',
      files: {
        '/package.json': JSON.stringify({ dependencies: { vite: '7.3.1' } }),
      },
      devDependencies: { vite: '8.0.16' },
    },
  ],
] satisfies ReadonlyArray<readonly [string, DefinitionOptions]>;

function snapshot(options: DefinitionOptions): DefinitionSnapshot {
  return inspectProjectDefinition(projects.vite(options));
}

function fileBytes(value: DefinitionSnapshot, path: string): Uint8Array {
  const bytes = value.files[path];
  if (bytes === undefined) throw new Error(`missing definition file: ${path}`);
  return bytes;
}

function fileText(value: DefinitionSnapshot, path: string): string {
  return decoder.decode(fileBytes(value, path));
}

function packageManifest(definition: Definition): PackageManifest {
  const parsed: unknown = JSON.parse(
    fileText(inspectProjectDefinition(definition), '/package.json'),
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('factory produced a non-object package.json');
  }
  return parsed as PackageManifest;
}

function prototypeKeyMap(version: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(`{"__proto__":${JSON.stringify(version)}}`);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('test dependency map is not an object');
  }
  return parsed as Readonly<Record<string, string>>;
}

describe('ProjectDefinition', () => {
  it('is an immutable branded handle and rejects forged definitions', () => {
    const definition = projects.vite({ id: 'opaque', files: {} });

    expect(Object.isFrozen(definition)).toBe(true);
    expect(inspectProjectDefinition(definition).kind).toBe('vite');

    const forged = Object.freeze({}) as unknown as Definition;
    expect(() => inspectProjectDefinition(forged)).toThrow();
  });

  it('defensively snapshots text, binary views, file maps, and dependency maps', () => {
    const backing = new Uint8Array([9, 0, 255, 8]);
    const binaryView = backing.subarray(1, 3);
    const files: Record<string, string | Uint8Array> = {
      '/binary.dat': binaryView,
      '/message.txt': 'before',
    };
    const dependencies: Record<string, string> = { kleur: '4.1.5' };
    const definition = projects.vite({ id: 'copies', files, dependencies });

    files['/message.txt'] = 'after';
    files['/binary.dat'] = new Uint8Array([7]);
    dependencies.kleur = '5.0.0';
    backing[1] = 4;
    backing[2] = 5;

    const first = inspectProjectDefinition(definition);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.files)).toBe(true);
    expect(fileText(first, '/message.txt')).toBe('before');
    expect(fileBytes(first, '/binary.dat')).toEqual(new Uint8Array([0, 255]));
    expect(fileBytes(first, '/binary.dat')).not.toBe(binaryView);
    expect(packageManifest(definition).dependencies).toEqual({ kleur: '4.1.5' });

    const identity = first.identity;
    fileBytes(first, '/binary.dat')[0] = 42;

    const second = inspectProjectDefinition(definition);
    expect(fileBytes(second, '/binary.dat')).toEqual(new Uint8Array([0, 255]));
    expect(second.identity).toBe(identity);
  });

  it.each([
    ['relative path', 'src/main.ts'],
    ['root directory', '/'],
    ['root traversal', '/../secret'],
    ['nested traversal', '/src/../secret'],
    ['reserved root', '/.rifty'],
    ['reserved descendant', '/.rifty/project.json'],
  ])('rejects %s (%s)', (_label, path) => {
    expect(() => projects.vite({ id: 'invalid-path', files: { [path]: 'x' } })).toThrow();
  });

  it('accepts a similarly named ordinary file without opening the reserved root', () => {
    const value = snapshot({ id: 'ordinary-path', files: { '/.rifty.json': 'visible' } });

    expect(fileText(value, '/.rifty.json')).toBe('visible');
  });

  it.each([
    ['invalid JSON', '{'],
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"package"'],
    ['number', '1'],
  ])('rejects a package.json that is %s', (_label, packageJson) => {
    expect(() =>
      projects.vite({ id: 'invalid-manifest', files: { '/package.json': packageJson } }),
    ).toThrow();
  });

  it('merges dependency options over the manifest and preserves every unrelated field', () => {
    const definition = projects.vite({
      id: 'manifest-merge',
      files: {
        '/package.json': JSON.stringify({
          name: 'host-project',
          private: false,
          scripts: { test: 'node test.mjs' },
          custom: { retained: true },
          dependencies: { keep: '1.0.0', override: 'old' },
          devDependencies: { devKeep: '2.0.0', devOverride: 'old' },
        }),
      },
      dependencies: { override: 'new', added: '3.0.0' },
      devDependencies: { devOverride: 'new', devAdded: '4.0.0' },
    });

    expect(packageManifest(definition)).toEqual({
      name: 'host-project',
      private: false,
      scripts: { test: 'node test.mjs' },
      custom: { retained: true },
      dependencies: { keep: '1.0.0', override: 'new', added: '3.0.0' },
      devDependencies: {
        devKeep: '2.0.0',
        devOverride: 'new',
        devAdded: '4.0.0',
        vite: '8.0.16',
      },
    });
  });

  it('preserves prototype-colliding dependency names in every ingress and in exact identity', () => {
    const cases: readonly {
      readonly section: 'dependencies' | 'devDependencies';
      readonly create: (version: string) => Definition;
    }[] = [
      {
        section: 'dependencies',
        create: (version) =>
          projects.vite({
            id: 'prototype-dependency-option',
            files: {},
            dependencies: prototypeKeyMap(version),
          }),
      },
      {
        section: 'devDependencies',
        create: (version) =>
          projects.vite({
            id: 'prototype-dev-dependency-option',
            files: {},
            devDependencies: prototypeKeyMap(version),
          }),
      },
      {
        section: 'dependencies',
        create: (version) =>
          projects.vite({
            id: 'prototype-manifest-dependency',
            files: {
              '/package.json': JSON.stringify({ dependencies: prototypeKeyMap(version) }),
            },
          }),
      },
      {
        section: 'devDependencies',
        create: (version) =>
          projects.vite({
            id: 'prototype-manifest-dev-dependency',
            files: {
              '/package.json': JSON.stringify({ devDependencies: prototypeKeyMap(version) }),
            },
          }),
      },
    ];

    for (const testCase of cases) {
      const first = testCase.create('1.0.0');
      const second = testCase.create('2.0.0');
      const dependencyMap = packageManifest(first)[testCase.section];

      expect(Object.prototype.hasOwnProperty.call(dependencyMap, '__proto__')).toBe(true);
      expect(Reflect.get(dependencyMap ?? {}, '__proto__')).toBe('1.0.0');
      expect(inspectProjectDefinition(second).identity).not.toBe(
        inspectProjectDefinition(first).identity,
      );
    }
  });

  it('adds pinned Vite 8 only when neither final dependency section declares Vite', () => {
    const defaulted = packageManifest(projects.vite({ id: 'default-vite', files: {} }));
    expect(defaulted.devDependencies).toEqual({ vite: '8.0.16' });

    const dependencyOwned = packageManifest(
      projects.vite({
        id: 'dependency-vite',
        files: {
          '/package.json': JSON.stringify({ dependencies: { vite: '7.3.1' } }),
        },
      }),
    );
    expect(dependencyOwned.dependencies).toEqual({ vite: '7.3.1' });
    expect(dependencyOwned.devDependencies?.vite).toBeUndefined();

    const devDependencyOwned = packageManifest(
      projects.vite({
        id: 'dev-dependency-vite',
        files: {},
        devDependencies: { vite: '9.0.0' },
      }),
    );
    expect(devDependencyOwned.devDependencies).toEqual({ vite: '9.0.0' });
  });

  it('uses viteVersion as the sole final Vite declaration', () => {
    const definition = projects.vite({
      id: 'explicit-vite',
      files: {
        '/package.json': JSON.stringify({ name: 'explicit', dependencies: { kleur: '4.1.5' } }),
      },
      devDependencies: { typescript: '5.9.3' },
      viteVersion: '8.0.16',
    });

    expect(packageManifest(definition)).toEqual({
      name: 'explicit',
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3', vite: '8.0.16' },
    });
  });

  it.each(VITE_VERSION_CONFLICTS)(
    'rejects viteVersion together with Vite in %s',
    (_label, supplied) => {
      expect(() =>
        projects.vite({ ...supplied, id: 'exclusive-vite', viteVersion: '8.0.16' }),
      ).toThrow();
    },
  );

  it.each(TWO_VITE_SECTIONS)(
    'rejects Vite declared in two final dependency sections: %s',
    (_label, options) => {
      expect(() => projects.vite(options)).toThrow();
    },
  );

  it('computes a canonical identity independent of record insertion order', () => {
    const packageJson = JSON.stringify({ name: 'canonical', scripts: { dev: 'vite' } });
    const first = snapshot({
      id: 'canonical',
      files: {
        '/package.json': packageJson,
        '/a.txt': 'alpha',
        '/b.bin': new Uint8Array([0, 255]),
      },
      dependencies: { alpha: '1.0.0', zeta: '2.0.0' },
      devDependencies: { beta: '3.0.0', theta: '4.0.0' },
      viteVersion: '8.0.16',
    });
    const reordered = snapshot({
      id: 'canonical',
      files: {
        '/b.bin': new Uint8Array([0, 255]),
        '/a.txt': 'alpha',
        '/package.json': packageJson,
      },
      dependencies: { zeta: '2.0.0', alpha: '1.0.0' },
      devDependencies: { theta: '4.0.0', beta: '3.0.0' },
      viteVersion: '8.0.16',
    });

    expect(reordered.identity).toBe(first.identity);

    const equivalentBytes = snapshot({
      id: 'canonical',
      files: {
        '/package.json': encoder.encode(packageJson),
        '/a.txt': encoder.encode('alpha'),
        '/b.bin': new Uint8Array([0, 255]),
      },
      dependencies: { alpha: '1.0.0', zeta: '2.0.0' },
      devDependencies: { beta: '3.0.0', theta: '4.0.0' },
      viteVersion: '8.0.16',
    });
    expect(equivalentBytes.identity).toBe(first.identity);
  });

  it('changes identity for every normalized intent change while the same id stays reusable', () => {
    const base = snapshot({
      id: 'shared-id',
      files: { '/main.js': 'console.log(1)' },
      dependencies: { kleur: '4.1.5' },
    });
    const changedFile = snapshot({
      id: 'shared-id',
      files: { '/main.js': 'console.log(2)' },
      dependencies: { kleur: '4.1.5' },
    });
    const changedDependency = snapshot({
      id: 'shared-id',
      files: { '/main.js': 'console.log(1)' },
      dependencies: { kleur: '4.1.6' },
    });
    const movedDependencySection = snapshot({
      id: 'shared-id',
      files: { '/main.js': 'console.log(1)' },
      devDependencies: { kleur: '4.1.5' },
    });
    const changedViteVersion = snapshot({
      id: 'shared-id',
      files: { '/main.js': 'console.log(1)' },
      dependencies: { kleur: '4.1.5' },
      viteVersion: '9.0.0',
    });

    expect(
      new Set([
        base.identity,
        changedFile.identity,
        changedDependency.identity,
        movedDependencySection.identity,
        changedViteVersion.identity,
      ]),
    ).toHaveProperty('size', 5);
    expect(changedFile.storageSegment).toBe(base.storageSegment);
    expect(changedDependency.storageSegment).toBe(base.storageSegment);
    expect(movedDependencySection.storageSegment).toBe(base.storageSegment);
    expect(changedViteVersion.storageSegment).toBe(base.storageSegment);
  });

  it('injectively encodes every non-empty host id into one safe storage segment', () => {
    const ids = [
      '.',
      '..',
      '/',
      '\\',
      '~',
      'a/b',
      'a\\b',
      'a~b',
      'astral-\u{1f680}',
      'unpaired-high-\ud800',
      'unpaired-high-\ud801',
      'unpaired-low-\udc00',
    ];

    const values = ids.map((id) => snapshot({ id, files: {} }));
    for (const [index, value] of values.entries()) {
      expect(value.id).toBe(ids[index]);
      expect(value.storageSegment).not.toBe('');
      expect(value.storageSegment).not.toBe('.');
      expect(value.storageSegment).not.toBe('..');
      expect(value.storageSegment).not.toContain('/');
      expect(value.storageSegment).not.toContain('\\');
    }
    expect(new Set(values.map((value) => value.storageSegment))).toHaveProperty('size', ids.length);

    expect(() => projects.vite({ id: '', files: {} })).toThrow();
  });
});
