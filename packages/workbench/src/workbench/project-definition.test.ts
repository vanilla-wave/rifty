import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PreviewHandle } from './preview-readiness.ts';
import {
  type ProjectDefinition,
  defineNodeCliProject,
  defineNodeServerProject,
  inspectProjectDefinition,
  inspectProjectDefinitionWire,
  projectDefinitionWire,
  projects,
} from './project-definition.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

type Definition = ReturnType<typeof projects.vite>;
type DefinitionOptions = Parameters<typeof projects.vite>[0];
type DefinitionSnapshot = ReturnType<typeof inspectProjectDefinition>;
type PublicWorkbenchModule = typeof import('./public.ts');

interface PackageManifest {
  readonly [field: string]: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

const PROVEN_VITE8_WASI_RUNTIME_OVERRIDE = {
  '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.1.6',
} as const;

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
      overrides: PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
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

  it.each([
    [
      'viteVersion option',
      {
        files: { '/package.json': '{"overrides":{"kleur":"npm:kleur@4.1.5"}}' },
        viteVersion: '8.0.15',
      },
    ],
    [
      'manifest dependency',
      {
        files: {
          '/package.json':
            '{"dependencies":{"vite":"7.3.1"},"overrides":{"kleur":"npm:kleur@4.1.5"}}',
        },
      },
    ],
    [
      'manifest devDependency',
      {
        files: {
          '/package.json':
            '{"devDependencies":{"vite":"9.0.0"},"overrides":{"kleur":"npm:kleur@4.1.5"}}',
        },
      },
    ],
    [
      'dependencies option',
      {
        files: { '/package.json': '{"overrides":{"kleur":"npm:kleur@4.1.5"}}' },
        dependencies: { vite: '7.3.1' },
      },
    ],
    [
      'devDependencies option',
      {
        files: { '/package.json': '{"overrides":{"kleur":"npm:kleur@4.1.5"}}' },
        devDependencies: { vite: '9.0.0' },
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, Omit<DefinitionOptions, 'id'>]>)(
    'leaves non-exact-Vite-8 overrides unchanged for %s',
    (_label, supplied) => {
      expect(
        packageManifest(projects.vite({ id: 'non-vite8-runtime-policy', ...supplied })).overrides,
      ).toEqual({ kleur: 'npm:kleur@4.1.5' });
    },
  );

  it.each([
    ['implicit default', { files: {} }],
    ['viteVersion option', { files: {}, viteVersion: '8.0.16' }],
    ['manifest dependency', { files: { '/package.json': '{"dependencies":{"vite":"8.0.16"}}' } }],
    [
      'manifest devDependency',
      { files: { '/package.json': '{"devDependencies":{"vite":"8.0.16"}}' } },
    ],
    ['dependencies option', { files: {}, dependencies: { vite: '8.0.16' } }],
    ['devDependencies option', { files: {}, devDependencies: { vite: '8.0.16' } }],
  ] satisfies ReadonlyArray<readonly [string, Omit<DefinitionOptions, 'id'>]>)(
    'pins the proven Rolldown WASI runtime for exact Vite 8 from %s',
    (_label, supplied) => {
      expect(
        packageManifest(projects.vite({ id: 'vite8-runtime-policy', ...supplied })).overrides,
      ).toEqual(PROVEN_VITE8_WASI_RUNTIME_OVERRIDE);
    },
  );

  it('merges unrelated overrides while caller ownership of the runtime override wins', () => {
    const defaultOwned = projects.vite({
      id: 'vite8-override-owner',
      files: {
        '/package.json': JSON.stringify({
          dependencies: { vite: '8.0.16' },
          overrides: { kleur: 'npm:kleur@4.1.5' },
        }),
      },
    });
    const callerOwned = projects.vite({
      id: 'vite8-override-owner',
      files: {
        '/package.json': JSON.stringify({
          dependencies: { vite: '8.0.16' },
          overrides: {
            kleur: 'npm:kleur@4.1.5',
            '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.2.0',
          },
        }),
      },
    });

    expect(packageManifest(defaultOwned).overrides).toEqual({
      kleur: 'npm:kleur@4.1.5',
      ...PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
    });
    expect(packageManifest(callerOwned).overrides).toEqual({
      kleur: 'npm:kleur@4.1.5',
      '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.2.0',
    });
    expect(inspectProjectDefinition(callerOwned).identity).not.toBe(
      inspectProjectDefinition(defaultOwned).identity,
    );
  });

  // Fault class: sibling-drift. The implicit package version and its visible
  // runtime policy are one default and must be normalized at one boundary.
  it('adds the visible Vite 8 policy with the implicit default before identity', () => {
    const policy = `export default {
  server: { hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
};
`;
    const definition = snapshot({ id: 'default-vite-policy', files: {} });
    const explicitSameBytes = snapshot({
      id: 'default-vite-policy',
      files: { '/vite.config.js': policy },
    });
    const editedPolicy = snapshot({
      id: 'default-vite-policy',
      files: { '/vite.config.js': `${policy}// user edit\n` },
    });

    expect(fileText(definition, '/vite.config.js')).toBe(policy);
    expect(definition.identity).toBe(explicitSameBytes.identity);
    expect(definition.identity).not.toBe(editedPolicy.identity);
    expect(
      inspectProjectDefinitionWire(structuredClone(projectDefinitionWire(definition))),
    ).toEqual(definition);
  });

  it.each([
    '/vite.config.js',
    '/vite.config.mjs',
    '/vite.config.ts',
    '/vite.config.cjs',
    '/vite.config.mts',
    '/vite.config.cts',
  ])('preserves user-owned %s without injecting a sibling config', (path) => {
    const source = `export default { marker: ${JSON.stringify(path)} };\n`;
    const definition = snapshot({ id: `user-config-${path}`, files: { [path]: source } });

    expect(fileText(definition, path)).toBe(source);
    expect(
      Object.keys(definition.files).filter((candidate) => candidate.startsWith('/vite.config.')),
    ).toEqual([path]);
  });

  it.each([
    ['viteVersion', { viteVersion: '8.0.16' }],
    ['manifest dependency', { files: { '/package.json': '{"dependencies":{"vite":"8.0.16"}}' } }],
    ['dependency option', { dependencies: { vite: '7.3.1' } }],
    ['devDependency option', { devDependencies: { vite: '9.0.0' } }],
  ] satisfies ReadonlyArray<readonly [string, Partial<Omit<DefinitionOptions, 'id'>>]>)(
    'leaves config ownership to an explicit Vite declaration from %s',
    (_label, supplied) => {
      const definition = snapshot({ id: 'explicit-vite-policy', files: {}, ...supplied });

      expect(definition.files['/vite.config.js']).toBeUndefined();
    },
  );

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
      overrides: PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
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

  describe('owner wire', () => {
    it('round-trips through structured clone while the owner recomputes derived identity', () => {
      const inspected = snapshot({
        id: 'wire-round-trip',
        files: {
          '/index.html': '<main>real bytes</main>',
          '/binary.dat': new Uint8Array([0, 127, 255]),
        },
      });

      const wire = projectDefinitionWire(inspected);
      const cloned = structuredClone(wire);
      const ownerInspected = inspectProjectDefinitionWire(cloned);

      expect(ownerInspected).toEqual(inspected);
      expect(ownerInspected.files['/binary.dat']).not.toBe(inspected.files['/binary.dat']);
      expect(ownerInspected.storageSegment).toBe('wire-round-trip');
      expect(Object.isFrozen(ownerInspected)).toBe(true);
      expect(Object.isFrozen(ownerInspected.files)).toBe(true);
    });

    // Fault class: provenance-lie. The wire carries the page claim only as a
    // comparison value; owner ingress derives identity from exact received bytes.
    it('rejects changed bytes even when the page identity claim is retained', () => {
      const inspected = snapshot({ id: 'wire-bytes', files: { '/message.txt': 'before' } });
      const wire = structuredClone(projectDefinitionWire(inspected));
      (wire.files as Record<string, Uint8Array>)['/message.txt'] = encoder.encode('after');

      expect(() => inspectProjectDefinitionWire(wire)).toThrow(/identity/i);
    });

    it('rejects a changed page identity claim instead of accepting owner-derived bytes silently', () => {
      const inspected = snapshot({ id: 'wire-identity', files: { '/message.txt': 'same' } });
      const wire = { ...structuredClone(projectDefinitionWire(inspected)), identity: 'forged' };

      expect(() => inspectProjectDefinitionWire(wire)).toThrow(/identity/i);
    });

    it.each([
      ['extra root field', (wire: Record<string, unknown>) => ({ ...wire, extra: true })],
      [
        'missing identity',
        (wire: Record<string, unknown>) => {
          const { identity: _identity, ...rest } = wire;
          return rest;
        },
      ],
      ['wrong kind', (wire: Record<string, unknown>) => ({ ...wire, kind: 'node' })],
      ['empty id', (wire: Record<string, unknown>) => ({ ...wire, id: '' })],
      ['non-record files', (wire: Record<string, unknown>) => ({ ...wire, files: [] })],
      [
        'non-byte file',
        (wire: Record<string, unknown>) => ({ ...wire, files: { '/index.html': 'text' } }),
      ],
      [
        'project traversal',
        (wire: Record<string, unknown>) => ({
          ...wire,
          files: { '/../outside': new Uint8Array([1]) },
        }),
      ],
    ])('rejects corrupt definition wire: %s', (_label, corrupt) => {
      const inspected = snapshot({ id: 'wire-invalid', files: { '/index.html': 'ok' } });
      const wire = structuredClone(projectDefinitionWire(inspected)) as unknown as Record<
        string,
        unknown
      >;

      expect(() => inspectProjectDefinitionWire(corrupt(wire))).toThrow(TypeError);
    });

    it('defensively snapshots both page egress and owner ingress bytes', () => {
      const inspected = snapshot({
        id: 'wire-copies',
        files: { '/value.bin': new Uint8Array([1]) },
      });
      const wire = projectDefinitionWire(inspected);
      const firstWireBytes = wire.files['/value.bin'];
      if (firstWireBytes === undefined) throw new Error('missing wire fixture');
      firstWireBytes[0] = 2;

      const freshWire = projectDefinitionWire(inspected);
      const ownerInspected = inspectProjectDefinitionWire(structuredClone(freshWire));
      const freshWireBytes = freshWire.files['/value.bin'];
      if (freshWireBytes === undefined) throw new Error('missing fresh wire fixture');
      freshWireBytes[0] = 3;

      expect(ownerInspected.files['/value.bin']).toEqual(new Uint8Array([1]));
    });
  });
});

interface NodeSnapshotBase {
  readonly id: string;
  readonly storageSegment: string;
  readonly identity: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

interface NodeServerSnapshot extends NodeSnapshotBase {
  readonly kind: 'node-server';
  readonly entryPath: string;
  readonly port: number;
}

interface NodeCliSnapshot extends NodeSnapshotBase {
  readonly kind: 'node-cli';
  readonly entryPath: string;
  readonly args: readonly string[];
}

const NODE_ENTRY = '/src/main.mjs';
const NODE_OTHER_ENTRY = '/src/other.mjs';

function nodeFiles(): Record<string, string | Uint8Array> {
  return {
    [NODE_ENTRY]: 'console.log("main");\n',
    [NODE_OTHER_ENTRY]: 'console.log("other");\n',
  };
}

function serverSnapshot(
  options: Parameters<typeof defineNodeServerProject>[0],
): NodeServerSnapshot {
  return inspectProjectDefinition(defineNodeServerProject(options)) as NodeServerSnapshot;
}

function cliSnapshot(options: Parameters<typeof defineNodeCliProject>[0]): NodeCliSnapshot {
  return inspectProjectDefinition(defineNodeCliProject(options)) as NodeCliSnapshot;
}

function nodeManifest(snapshot: NodeSnapshotBase): PackageManifest {
  const bytes = snapshot.files['/package.json'];
  if (bytes === undefined) throw new Error('Node definition did not materialize /package.json');
  const parsed: unknown = JSON.parse(decoder.decode(bytes));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Node definition produced a non-object package.json');
  }
  return parsed as PackageManifest;
}

function mutableNodeWire(
  definition: ReturnType<typeof defineNodeServerProject> | ReturnType<typeof defineNodeCliProject>,
): Record<string, unknown> {
  return structuredClone(
    projectDefinitionWire(inspectProjectDefinition(definition)),
  ) as unknown as Record<string, unknown>;
}

describe('package-private finite Node project definitions', () => {
  it('returns the two readiness-specialized opaque definition types without widening projects', () => {
    const server = defineNodeServerProject({
      id: 'typed-server',
      files: nodeFiles(),
      entryPath: NODE_ENTRY,
      port: 4321,
    });
    const cli = defineNodeCliProject({
      id: 'typed-cli',
      files: nodeFiles(),
      entryPath: NODE_ENTRY,
    });

    expectTypeOf(server).toEqualTypeOf<ProjectDefinition<PreviewHandle>>();
    expectTypeOf(cli).toEqualTypeOf<ProjectDefinition<void>>();
    expectTypeOf<
      Extract<keyof PublicWorkbenchModule, 'defineNodeServerProject' | 'defineNodeCliProject'>
    >().toEqualTypeOf<never>();
    expect(Object.keys(projects)).toEqual(['vite']);
    expect(Object.isFrozen(server)).toBe(true);
    expect(Object.isFrozen(cli)).toBe(true);
  });

  it('deep-snapshots files, dependency maps, and CLI args into frozen inspected values', () => {
    const backing = new Uint8Array([9, 1, 2, 8]);
    const entryBytes = backing.subarray(1, 3);
    const files: Record<string, string | Uint8Array> = {
      [NODE_ENTRY]: entryBytes,
      '/package.json': JSON.stringify({
        name: 'node-plan',
        dependencies: { retained: '1.0.0' },
      }),
    };
    const dependencies: Record<string, string> = { kleur: '4.1.5' };
    const devDependencies: Record<string, string> = { typescript: '5.9.3' };
    const args = ['--mode', 'before'];
    const server = defineNodeServerProject({
      id: 'copied-server',
      files,
      dependencies,
      devDependencies,
      entryPath: NODE_ENTRY,
      port: 4321,
    });
    const cli = defineNodeCliProject({
      id: 'copied-cli',
      files,
      dependencies,
      devDependencies,
      entryPath: NODE_ENTRY,
      args,
    });

    backing[1] = 7;
    backing[2] = 8;
    files[NODE_ENTRY] = 'changed';
    dependencies.kleur = '5.0.0';
    devDependencies.typescript = '6.0.0';
    args.push('after');

    const inspectedServer = inspectProjectDefinition(server) as NodeServerSnapshot;
    const inspectedCli = inspectProjectDefinition(cli) as NodeCliSnapshot;
    expect(Object.isFrozen(inspectedServer)).toBe(true);
    expect(Object.isFrozen(inspectedServer.files)).toBe(true);
    expect(Object.isFrozen(inspectedCli)).toBe(true);
    expect(Object.isFrozen(inspectedCli.files)).toBe(true);
    expect(Object.isFrozen(inspectedCli.args)).toBe(true);
    expect(inspectedServer.files[NODE_ENTRY]).toEqual(new Uint8Array([1, 2]));
    expect(inspectedCli.files[NODE_ENTRY]).toEqual(new Uint8Array([1, 2]));
    expect(inspectedCli.args).toEqual(['--mode', 'before']);
    expect(nodeManifest(inspectedServer)).toMatchObject({
      dependencies: { retained: '1.0.0', kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
    });
    expect(nodeManifest(inspectedCli)).toMatchObject({
      dependencies: { retained: '1.0.0', kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
    });

    const serverBytes = inspectedServer.files[NODE_ENTRY];
    const cliBytes = inspectedCli.files[NODE_ENTRY];
    if (serverBytes === undefined || cliBytes === undefined) throw new Error('missing Node entry');
    serverBytes[0] = 99;
    cliBytes[0] = 98;
    expect((inspectProjectDefinition(server) as NodeServerSnapshot).files[NODE_ENTRY]).toEqual(
      new Uint8Array([1, 2]),
    );
    expect((inspectProjectDefinition(cli) as NodeCliSnapshot).files[NODE_ENTRY]).toEqual(
      new Uint8Array([1, 2]),
    );
  });

  it('canonicalizes omitted CLI args to one frozen empty list', () => {
    const inspected = cliSnapshot({
      id: 'default-args',
      files: nodeFiles(),
      entryPath: NODE_ENTRY,
    });

    expect(inspected.args).toEqual([]);
    expect(Object.isFrozen(inspected.args)).toBe(true);
  });

  it('preserves an explicitly declared Node-server dev lifecycle body', () => {
    const entryPath = "/scripts/server report's.mjs";
    const inspected = serverSnapshot({
      id: 'server-dev-script',
      files: {
        [entryPath]: 'console.log("server");\n',
        '/package.json': JSON.stringify({
          scripts: { dev: 'node custom-dev.mjs', build: 'node build.mjs' },
        }),
      },
      entryPath,
      port: 4321,
    });

    expect(nodeManifest(inspected).scripts).toEqual({
      build: 'node build.mjs',
      dev: 'node custom-dev.mjs',
    });
  });

  it('preserves an exact declared dev script so Workbench can select installed nodemon by bytes', () => {
    const exactDev = 'nodemon --legacy-watch --no-stdin --no-update-notifier src/main.mjs';
    const inspected = serverSnapshot({
      id: 'server-installed-nodemon',
      files: {
        [NODE_ENTRY]: 'console.log("server");\n',
        '/package.json': JSON.stringify({
          scripts: { dev: exactDev, start: 'node src/main.mjs' },
          dependencies: { nodemon: '3.1.14' },
        }),
      },
      entryPath: NODE_ENTRY,
      port: 4321,
    });

    expect(nodeManifest(inspected)).toMatchObject({
      scripts: { dev: exactDev, start: 'node src/main.mjs' },
      dependencies: { nodemon: '3.1.14' },
    });
  });

  // Fault classes: corrupt-input + lossy-aggregate. Every own JSON key must
  // survive normalization before the normalized bytes become exact identity.
  it('preserves prototype-colliding scripts before exact Node-server identity', () => {
    const entryPath = "/scripts/server report's.mjs";
    const create = (prototypeScript: string): NodeServerSnapshot =>
      serverSnapshot({
        id: 'server-prototype-script',
        files: {
          [entryPath]: 'console.log("server");\n',
          '/package.json': JSON.stringify({ scripts: prototypeKeyMap(prototypeScript) }),
        },
        entryPath,
        port: 4321,
      });
    const first = create('node first.mjs');
    const second = create('node second.mjs');
    const firstScripts = nodeManifest(first).scripts;
    const firstPackageJson = first.files['/package.json'];
    const secondPackageJson = second.files['/package.json'];
    if (firstPackageJson === undefined || secondPackageJson === undefined) {
      throw new Error('Node definition did not materialize /package.json');
    }

    expect.soft(Object.prototype.hasOwnProperty.call(firstScripts, '__proto__')).toBe(true);
    expect.soft(Object.prototype.propertyIsEnumerable.call(firstScripts, '__proto__')).toBe(true);
    expect.soft(Reflect.get(firstScripts ?? {}, '__proto__')).toBe('node first.mjs');
    expect.soft(firstScripts?.dev).toBe("node 'scripts/server report'\\''s.mjs'");
    expect.soft(decoder.decode(firstPackageJson)).not.toBe(decoder.decode(secondPackageJson));
    expect.soft(first.identity).not.toBe(second.identity);
  });

  it('round-trips exact Node metadata and independent bytes through structured clone', () => {
    const definitions = [
      defineNodeServerProject({
        id: 'wire-server',
        files: nodeFiles(),
        entryPath: NODE_ENTRY,
        port: 4321,
      }),
      defineNodeCliProject({
        id: 'wire-cli',
        files: nodeFiles(),
        entryPath: NODE_ENTRY,
        args: ['--format', 'json'],
      }),
    ] as const;

    for (const definition of definitions) {
      const inspectedDefinition = inspectProjectDefinition(definition);
      const inspected = inspectedDefinition as NodeServerSnapshot | NodeCliSnapshot;
      const wire = projectDefinitionWire(inspectedDefinition);
      const ownerInspected = inspectProjectDefinitionWire(structuredClone(wire)) as
        | NodeServerSnapshot
        | NodeCliSnapshot;

      expect(ownerInspected).toEqual(inspected);
      expect(ownerInspected.files[NODE_ENTRY]).not.toBe(inspected.files[NODE_ENTRY]);
      expect(Object.isFrozen(wire)).toBe(true);
      expect(
        Object.isFrozen(
          (wire as unknown as { readonly files: Readonly<Record<string, Uint8Array>> }).files,
        ),
      ).toBe(true);
      expect(Object.isFrozen(ownerInspected)).toBe(true);
      expect(Object.isFrozen(ownerInspected.files)).toBe(true);
      if (ownerInspected.kind === 'node-cli') {
        if (inspected.kind !== 'node-cli') throw new Error('Node wire changed runtime kind');
        expect(
          Object.isFrozen((wire as unknown as { readonly args: readonly string[] }).args),
        ).toBe(true);
        expect(Object.isFrozen(ownerInspected.args)).toBe(true);
        expect(ownerInspected.args).not.toBe(inspected.args);
      }
    }
  });

  it('changes exact identity when kind, entry, port, or CLI args change', () => {
    const files = nodeFiles();
    const server = serverSnapshot({
      id: 'identity-node',
      files,
      entryPath: NODE_ENTRY,
      port: 4321,
    });
    const changedServerEntry = serverSnapshot({
      id: 'identity-node',
      files,
      entryPath: NODE_OTHER_ENTRY,
      port: 4321,
    });
    const changedServerPort = serverSnapshot({
      id: 'identity-node',
      files,
      entryPath: NODE_ENTRY,
      port: 4322,
    });
    const cli = cliSnapshot({
      id: 'identity-node',
      files,
      entryPath: NODE_ENTRY,
      args: [],
    });
    const changedCliEntry = cliSnapshot({
      id: 'identity-node',
      files,
      entryPath: NODE_OTHER_ENTRY,
      args: [],
    });
    const changedCliArgs = cliSnapshot({
      id: 'identity-node',
      files,
      entryPath: NODE_ENTRY,
      args: ['--changed'],
    });

    expect(cli.identity).not.toBe(server.identity);
    expect(changedServerEntry.identity).not.toBe(server.identity);
    expect(changedServerPort.identity).not.toBe(server.identity);
    expect(changedCliEntry.identity).not.toBe(cli.identity);
    expect(changedCliArgs.identity).not.toBe(cli.identity);
  });

  it.each([
    [
      'server',
      () =>
        defineNodeServerProject({
          id: 'missing-server',
          files: {},
          entryPath: NODE_ENTRY,
          port: 4321,
        }),
    ],
    ['CLI', () => defineNodeCliProject({ id: 'missing-cli', files: {}, entryPath: NODE_ENTRY })],
  ])('rejects a %s definition whose declared entry is absent', (_label, create) => {
    expect(create).toThrow(/entry/i);
  });

  it.each([
    [
      'server traversal',
      () =>
        defineNodeServerProject({
          id: 'server-traversal',
          files: nodeFiles(),
          entryPath: '/src/../src/main.mjs',
          port: 4321,
        }),
    ],
    [
      'CLI traversal',
      () =>
        defineNodeCliProject({
          id: 'cli-traversal',
          files: nodeFiles(),
          entryPath: '/src/../src/main.mjs',
        }),
    ],
  ])('rejects unsafe Node entry metadata: %s', (_label, create) => {
    expect(create).toThrow(/entry/i);
  });

  it('rejects NUL-bearing CLI arguments at definition ingress', () => {
    expect(() =>
      defineNodeCliProject({
        id: 'nul-arg',
        files: nodeFiles(),
        entryPath: NODE_ENTRY,
        args: ['safe', 'unsafe\0suffix'],
      }),
    ).toThrow(/argument.*NUL/i);
  });

  it.each([0, -1, 1.5, 65_536, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid Node server port %s',
    (port) => {
      expect(() =>
        defineNodeServerProject({
          id: 'invalid-port',
          files: nodeFiles(),
          entryPath: NODE_ENTRY,
          port,
        }),
      ).toThrow(RangeError);
    },
  );

  it.each([1, 65_535])('accepts boundary Node server port %s', (port) => {
    expect(
      serverSnapshot({
        id: `boundary-port-${port}`,
        files: nodeFiles(),
        entryPath: NODE_ENTRY,
        port,
      }).port,
    ).toBe(port);
  });

  it('emits exact runtime-specific wire fields', () => {
    const server = defineNodeServerProject({
      id: 'wire-shape-server',
      files: nodeFiles(),
      entryPath: NODE_ENTRY,
      port: 4321,
    });
    const cli = defineNodeCliProject({
      id: 'wire-shape-cli',
      files: nodeFiles(),
      entryPath: NODE_ENTRY,
    });

    expect(Object.keys(mutableNodeWire(server)).sort()).toEqual([
      'entryPath',
      'files',
      'id',
      'identity',
      'kind',
      'port',
    ]);
    expect(Object.keys(mutableNodeWire(cli)).sort()).toEqual([
      'args',
      'entryPath',
      'files',
      'id',
      'identity',
      'kind',
    ]);
  });

  // Fault class: corrupt-input. Runtime-specific wire fields stay exact at the
  // one owner ingress instead of drifting into per-consumer validation.
  it.each([
    [
      'extra server field',
      () => ({
        ...mutableNodeWire(
          defineNodeServerProject({
            id: 'wire-extra-server',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        ),
        extra: true,
      }),
    ],
    [
      'server args field',
      () => ({
        ...mutableNodeWire(
          defineNodeServerProject({
            id: 'wire-server-args',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        ),
        args: [],
      }),
    ],
    [
      'missing server port',
      () => {
        const { port: _port, ...wire } = mutableNodeWire(
          defineNodeServerProject({
            id: 'wire-missing-port',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        );
        return wire;
      },
    ],
    [
      'extra CLI field',
      () => ({
        ...mutableNodeWire(
          defineNodeCliProject({
            id: 'wire-extra-cli',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
          }),
        ),
        extra: true,
      }),
    ],
    [
      'CLI port field',
      () => ({
        ...mutableNodeWire(
          defineNodeCliProject({
            id: 'wire-cli-port',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
          }),
        ),
        port: 4321,
      }),
    ],
    [
      'missing CLI args',
      () => {
        const { args: _args, ...wire } = mutableNodeWire(
          defineNodeCliProject({
            id: 'wire-missing-args',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
          }),
        );
        return wire;
      },
    ],
  ])('rejects non-exact Node definition wire: %s', (_label, wire) => {
    expect(() => inspectProjectDefinitionWire(wire())).toThrow(/wire/i);
  });

  // Fault class: provenance-lie. Owner ingress derives identity from exact
  // received runtime metadata; the page's retained claim is never authority.
  it.each([
    [
      'server entry',
      () => {
        const wire = mutableNodeWire(
          defineNodeServerProject({
            id: 'tamper-server-entry',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        );
        wire.entryPath = NODE_OTHER_ENTRY;
        return wire;
      },
    ],
    [
      'server port',
      () => {
        const wire = mutableNodeWire(
          defineNodeServerProject({
            id: 'tamper-server-port',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        );
        wire.port = 4322;
        return wire;
      },
    ],
    [
      'CLI entry',
      () => {
        const wire = mutableNodeWire(
          defineNodeCliProject({
            id: 'tamper-cli-entry',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
          }),
        );
        wire.entryPath = NODE_OTHER_ENTRY;
        return wire;
      },
    ],
    [
      'CLI args',
      () => {
        const wire = mutableNodeWire(
          defineNodeCliProject({
            id: 'tamper-cli-args',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            args: ['before'],
          }),
        );
        wire.args = ['after'];
        return wire;
      },
    ],
    [
      'runtime kind',
      () => {
        const { port: _port, ...wire } = mutableNodeWire(
          defineNodeServerProject({
            id: 'tamper-kind',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        );
        return { ...wire, kind: 'node-cli', args: [] };
      },
    ],
  ])(
    'rejects structurally valid Node metadata tamper with retained identity: %s',
    (_label, wire) => {
      expect(() => inspectProjectDefinitionWire(wire())).toThrow(/identity/i);
    },
  );

  it.each([
    [
      'unsafe wire entry traversal',
      () => {
        const wire = mutableNodeWire(
          defineNodeServerProject({
            id: 'unsafe-wire-entry',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        );
        wire.entryPath = '/src/../src/main.mjs';
        return wire;
      },
      /entry/i,
    ],
    [
      'invalid wire port',
      () => {
        const wire = mutableNodeWire(
          defineNodeServerProject({
            id: 'unsafe-wire-port',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
            port: 4321,
          }),
        );
        wire.port = 0;
        return wire;
      },
      /port must be an integer from 1 to 65535/i,
    ],
    [
      'NUL-bearing wire argument',
      () => {
        const wire = mutableNodeWire(
          defineNodeCliProject({
            id: 'unsafe-wire-arg',
            files: nodeFiles(),
            entryPath: NODE_ENTRY,
          }),
        );
        wire.args = ['unsafe\0suffix'];
        return wire;
      },
      /argument.*NUL/i,
    ],
  ])('rejects invalid Node runtime wire metadata: %s', (_label, wire, expected) => {
    expect(() => inspectProjectDefinitionWire(wire())).toThrow(expected);
  });
});
