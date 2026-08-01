import { describe, expect, it } from 'vitest';
import lightningRegistryGolden from '../fixtures/lightningcss-wasm-1.32.0-registry.json';
import lightningTarballGolden from '../fixtures/lightningcss-wasm-1.32.0-tarball.json';
import * as rootShadowRegistry from '../index.ts';
import { shadowDigest, shadowSha256 } from './canonical.ts';
import {
  ShadowRegistryCodecError,
  builtinShadowSubstitutionCatalog,
  decodeBuiltinShadowSubstitutionCatalog,
  decodeShadowSubstitutionCatalog,
} from './codec.ts';
import * as internalShadowRegistry from './index.ts';

function rawFile(path: string, content: string) {
  return {
    path,
    content,
    sha256: shadowSha256(content),
    bytes: new TextEncoder().encode(content).byteLength,
  };
}

function withDigest<T extends object>(value: T): T & Readonly<{ digest: string }> {
  return { ...value, digest: shadowDigest(value) };
}

function rawSchema2Catalog() {
  const assetId = 'contract.esbuild-runtime.v1';
  const recipes = [
    withDigest({
      schema: 2 as const,
      id: 'contract.esbuild.v2',
      trigger: { name: 'esbuild', version: '0.28.0' },
      admission: {
        kind: 'semver-admits' as const,
        unsupportedFeature: 'esbuild.version',
      },
      acquisition: { kind: 'synthetic' as const },
      materialization: {
        name: 'esbuild',
        version: '0.28.0',
        bin: { esbuild: 'bin/esbuild' },
        files: [
          rawFile('bin/esbuild', '#!/usr/bin/env node\n'),
          rawFile(
            'package.json',
            JSON.stringify({
              name: 'esbuild',
              version: '0.28.0',
              bin: { esbuild: './bin/esbuild' },
            }),
          ),
        ],
      },
      binding: { adapterId: 'contract.esbuild-adapter.v1', assets: [assetId] },
    }),
    withDigest({
      schema: 2 as const,
      id: 'contract.lightningcss.v2',
      trigger: { name: 'lightningcss', version: '1.32.0' },
      admission: {
        kind: 'semver-admits' as const,
        unsupportedFeature: 'lightningcss.version',
      },
      acquisition: {
        kind: 'registry' as const,
        name: 'lightningcss-wasm',
        version: '1.32.0',
        dependencyProjection: {
          dependencies: { 'napi-wasm': '^1.0.1' },
          optionalDependencies: {},
          omittedOptionalDependencies: {},
          peerDependencies: {},
          bundledDependencies: ['napi-wasm'],
          unsupportedFeature: 'lightningcss.acquisition',
        },
      },
      materialization: {
        name: 'lightningcss',
        version: '1.32.0',
        bin: {},
        files: [
          rawFile('package.json', JSON.stringify({ name: 'lightningcss', version: '1.32.0' })),
        ],
      },
    }),
  ];
  const payload = {
    schema: 2 as const,
    id: 'contract.shadow-substitutions.v2',
    recipes,
    assets: [
      {
        id: assetId,
        source: {
          name: '@contract/esbuild-runtime',
          version: '0.28.0',
          integrity: `sha512-${btoa('\0'.repeat(64))}`,
        },
        member: 'package/bin/esbuild.wasm',
        memberSha256: '0'.repeat(64),
        memberSize: 1,
        maxTarballBytes: 2,
        maxUnpackedBytes: 3,
      },
    ],
  };
  return { ...payload, digest: shadowDigest(payload) };
}

type RawCatalog = ReturnType<typeof rawSchema2Catalog>;

function recordAt(value: unknown, path: readonly PropertyKey[]): Record<PropertyKey, unknown> {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      throw new Error(`fixture path ${path.map(String).join('.')} is not an object`);
    }
    current = Reflect.get(current, key);
  }
  if (current === null || typeof current !== 'object') {
    throw new Error(`fixture path ${path.map(String).join('.')} is not an object`);
  }
  return current as Record<PropertyKey, unknown>;
}

function setAt(catalog: RawCatalog, path: readonly PropertyKey[], value: unknown): void {
  const key = path.at(-1);
  if (key === undefined) throw new Error('fixture mutation path is empty');
  Reflect.set(recordAt(catalog, path.slice(0, -1)), key, value);
}

function resign(catalog: RawCatalog): void {
  for (const recipe of catalog.recipes) {
    const recipeRecord = recipe as unknown as Record<string, unknown>;
    const { digest: _digest, ...payload } = recipeRecord;
    Reflect.set(recipeRecord, 'digest', shadowDigest(payload));
  }
  const catalogRecord = catalog as unknown as Record<string, unknown>;
  const { digest: _digest, ...payload } = catalogRecord;
  Reflect.set(catalogRecord, 'digest', shadowDigest(payload));
}

function replacePackageManifest(catalog: RawCatalog, recipeIndex: number, manifest: unknown): void {
  const files = catalog.recipes[recipeIndex]!.materialization.files;
  const index = files.findIndex((file) => file.path === 'package.json');
  if (index === -1) throw new Error('fixture package.json is missing');
  files[index] = rawFile('package.json', JSON.stringify(manifest));
}

interface FailureTuple {
  readonly className: string;
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function captureRunFailure(run: () => unknown): FailureTuple {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ShadowRegistryCodecError);
    const failure = error as ShadowRegistryCodecError;
    return {
      className: failure.name,
      code: failure.code,
      path: failure.path,
      message: failure.message,
    };
  }
  throw new Error('expected schema-2 catalog decoding to fail');
}

function captureFailure(value: unknown): FailureTuple {
  return captureRunFailure(() => decodeShadowSubstitutionCatalog(value));
}

function expectedFailure(path: string, detail: string): FailureTuple {
  return {
    className: 'ShadowRegistryCodecError',
    code: 'ESHADOWREGISTRYCODEC',
    path,
    message: `shadow registry ${path}: ${detail}`,
  };
}

interface MutationCase {
  readonly label: string;
  readonly path: string;
  readonly detail: string;
  readonly forge: (catalog: RawCatalog) => void;
}

function mutation(
  label: string,
  path: string,
  detail: string,
  forge: (catalog: RawCatalog) => void,
): MutationCase {
  return { label, path, detail, forge };
}

function directMutation(
  label: string,
  path: string,
  detail: string,
  target: readonly PropertyKey[],
  value: unknown,
): MutationCase {
  return mutation(label, path, detail, (catalog) => setAt(catalog, target, value));
}

function deleteMutation(
  label: string,
  path: string,
  detail: string,
  target: readonly PropertyKey[],
): MutationCase {
  return mutation(label, path, detail, (catalog) => {
    const key = target.at(-1);
    if (key === undefined) throw new Error('fixture deletion path is empty');
    Reflect.deleteProperty(recordAt(catalog, target.slice(0, -1)), key);
  });
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) expectDeepFrozen(descriptor.value);
  }
}

const DATA_MUTATIONS: readonly MutationCase[] = [
  directMutation('catalog schema 1', 'catalog.schema', 'unsupported schema', ['schema'], 1),
  directMutation(
    'recipe schema 1',
    'catalog.recipes[0].schema',
    'unsupported schema',
    ['recipes', 0, 'schema'],
    1,
  ),
  directMutation(
    'sparse recipes',
    'catalog.recipes',
    'must be dense and have no extra fields',
    ['recipes'],
    new Array<unknown>(1),
  ),
  deleteMutation('missing catalog id', 'catalog', 'extra or missing fields', ['id']),
  deleteMutation('missing recipe id', 'catalog.recipes[0]', 'extra or missing fields', [
    'recipes',
    0,
    'id',
  ]),
  deleteMutation(
    'missing trigger version',
    'catalog.recipes[0].trigger',
    'extra or missing fields',
    ['recipes', 0, 'trigger', 'version'],
  ),
  deleteMutation(
    'missing admission kind',
    'catalog.recipes[0].admission',
    'extra or missing fields',
    ['recipes', 0, 'admission', 'kind'],
  ),
  deleteMutation(
    'missing synthetic acquisition kind',
    'catalog.recipes[0].acquisition.kind',
    'unsupported acquisition',
    ['recipes', 0, 'acquisition', 'kind'],
  ),
  deleteMutation(
    'missing registry acquisition name',
    'catalog.recipes[1].acquisition',
    'extra or missing fields',
    ['recipes', 1, 'acquisition', 'name'],
  ),
  deleteMutation(
    'missing dependency projection map',
    'catalog.recipes[1].acquisition.dependencyProjection',
    'extra or missing fields',
    ['recipes', 1, 'acquisition', 'dependencyProjection', 'peerDependencies'],
  ),
  deleteMutation(
    'missing materialization files',
    'catalog.recipes[0].materialization',
    'extra or missing fields',
    ['recipes', 0, 'materialization', 'files'],
  ),
  deleteMutation(
    'missing materialization file bytes',
    'catalog.recipes[0].materialization.files[0]',
    'extra or missing fields',
    ['recipes', 0, 'materialization', 'files', 0, 'bytes'],
  ),
  deleteMutation(
    'missing binding adapter',
    'catalog.recipes[0].binding',
    'extra or missing fields',
    ['recipes', 0, 'binding', 'adapterId'],
  ),
  deleteMutation('missing asset member', 'catalog.assets[0]', 'extra or missing fields', [
    'assets',
    0,
    'member',
  ]),
  deleteMutation(
    'missing asset source integrity',
    'catalog.assets[0].source',
    'extra or missing fields',
    ['assets', 0, 'source', 'integrity'],
  ),
  mutation('non-enumerable required field', 'catalog', 'extra or missing fields', (catalog) => {
    Object.defineProperty(catalog, 'id', {
      configurable: true,
      enumerable: false,
      value: catalog.id,
      writable: true,
    });
  }),
  mutation('unknown catalog field', 'catalog', 'extra or missing fields', (catalog) => {
    Reflect.set(catalog, 'unexpected', true);
  }),
  mutation('unknown recipe field', 'catalog.recipes[0]', 'extra or missing fields', (catalog) => {
    Reflect.set(catalog.recipes[0]!, 'unexpected', true);
  }),
  mutation(
    'unknown trigger field',
    'catalog.recipes[0].trigger',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.recipes[0]!.trigger, 'unexpected', true);
    },
  ),
  mutation(
    'unknown admission field',
    'catalog.recipes[0].admission',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.recipes[0]!.admission, 'unexpected', true);
    },
  ),
  mutation(
    'unknown synthetic acquisition field',
    'catalog.recipes[0].acquisition',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.recipes[0]!.acquisition, 'unexpected', true);
    },
  ),
  mutation(
    'unknown registry acquisition field',
    'catalog.recipes[1].acquisition',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.recipes[1]!.acquisition, 'integrity', 'forbidden');
    },
  ),
  mutation(
    'unknown dependency projection field',
    'catalog.recipes[1].acquisition.dependencyProjection',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(
        recordAt(catalog, ['recipes', 1, 'acquisition', 'dependencyProjection']),
        'unexpected',
        {},
      );
    },
  ),
  mutation(
    'unknown materialization field',
    'catalog.recipes[0].materialization',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.recipes[0]!.materialization, 'unexpected', true);
    },
  ),
  mutation(
    'unknown materialization file field',
    'catalog.recipes[0].materialization.files[0]',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.recipes[0]!.materialization.files[0]!, 'unexpected', true);
    },
  ),
  mutation(
    'unknown binding field',
    'catalog.recipes[0].binding',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(recordAt(catalog, ['recipes', 0, 'binding']), 'unexpected', true);
    },
  ),
  mutation('unknown asset field', 'catalog.assets[0]', 'extra or missing fields', (catalog) => {
    Reflect.set(catalog.assets[0]!, 'unexpected', true);
  }),
  mutation(
    'unknown asset source field',
    'catalog.assets[0].source',
    'extra or missing fields',
    (catalog) => {
      Reflect.set(catalog.assets[0]!.source, 'unexpected', true);
    },
  ),
  directMutation(
    'unsupported admission kind',
    'catalog.recipes[0].admission.kind',
    'unsupported admission',
    ['recipes', 0, 'admission', 'kind'],
    'range-ish',
  ),
  directMutation(
    'unsupported acquisition kind',
    'catalog.recipes[0].acquisition.kind',
    'unsupported acquisition',
    ['recipes', 0, 'acquisition', 'kind'],
    'tarball',
  ),
  directMutation('invalid catalog id', 'catalog.id', 'invalid identifier', ['id'], ''),
  directMutation(
    'invalid recipe id',
    'catalog.recipes[0].id',
    'invalid identifier',
    ['recipes', 0, 'id'],
    '',
  ),
  directMutation(
    'invalid admission feature',
    'catalog.recipes[0].admission.unsupportedFeature',
    'invalid identifier',
    ['recipes', 0, 'admission', 'unsupportedFeature'],
    '',
  ),
  directMutation(
    'invalid acquisition feature',
    'catalog.recipes[1].acquisition.dependencyProjection.unsupportedFeature',
    'invalid identifier',
    ['recipes', 1, 'acquisition', 'dependencyProjection', 'unsupportedFeature'],
    '',
  ),
  directMutation(
    'invalid trigger package name',
    'catalog.recipes[0].trigger.name',
    'invalid package name',
    ['recipes', 0, 'trigger', 'name'],
    'unscoped/slash',
  ),
  directMutation(
    'invalid acquisition package name',
    'catalog.recipes[1].acquisition.name',
    'invalid package name',
    ['recipes', 1, 'acquisition', 'name'],
    '@scope/',
  ),
  directMutation(
    'invalid materialization package name',
    'catalog.recipes[0].materialization.name',
    'invalid package name',
    ['recipes', 0, 'materialization', 'name'],
    '-leading',
  ),
  directMutation(
    'invalid runtime source package name',
    'catalog.assets[0].source.name',
    'invalid package name',
    ['assets', 0, 'source', 'name'],
    '@scope//pkg',
  ),
  directMutation(
    'invalid trigger version',
    'catalog.recipes[0].trigger.version',
    'invalid exact version',
    ['recipes', 0, 'trigger', 'version'],
    '^0.28.0',
  ),
  directMutation(
    'invalid acquisition version',
    'catalog.recipes[1].acquisition.version',
    'invalid exact version',
    ['recipes', 1, 'acquisition', 'version'],
    'latest',
  ),
  directMutation(
    'invalid materialization version',
    'catalog.recipes[0].materialization.version',
    'invalid exact version',
    ['recipes', 0, 'materialization', 'version'],
    'v0.28.0',
  ),
  directMutation(
    'invalid runtime source version',
    'catalog.assets[0].source.version',
    'invalid exact version',
    ['assets', 0, 'source', 'version'],
    '0.28',
  ),
  ...(
    [
      'dependencies',
      'optionalDependencies',
      'omittedOptionalDependencies',
      'peerDependencies',
    ] as const
  ).flatMap((mapName) => {
    const mapPath = `catalog.recipes[1].acquisition.dependencyProjection.${mapName}`;
    const target = ['recipes', 1, 'acquisition', 'dependencyProjection', mapName] as const;
    return [
      directMutation(`non-record ${mapName}`, mapPath, 'must be a plain object', target, []),
      mutation(
        `invalid ${mapName} package key`,
        `${mapPath} key`,
        'invalid package name',
        (catalog) => {
          Reflect.set(recordAt(catalog, target), 'scope/pkg', '1.0.0');
        },
      ),
      directMutation(
        `empty ${mapName} range`,
        `${mapPath}.@contract/dependency`,
        'must be a non-empty string',
        [...target, '@contract/dependency'],
        '',
      ),
    ];
  }),
  mutation(
    'dependency map overlap',
    'catalog.recipes[1].acquisition.dependencyProjection',
    'dependency maps overlap at napi-wasm',
    (catalog) => {
      Reflect.set(
        recordAt(catalog, [
          'recipes',
          1,
          'acquisition',
          'dependencyProjection',
          'optionalDependencies',
        ]),
        'napi-wasm',
        '^1.0.1',
      );
      resign(catalog);
    },
  ),
  mutation(
    'duplicate recipe identity',
    'catalog.recipes',
    'duplicate identity or non-canonical ordering',
    (catalog) => {
      catalog.recipes[1] = structuredClone(catalog.recipes[0]!);
      resign(catalog);
    },
  ),
  directMutation(
    'sparse bundled dependencies',
    'catalog.recipes[1].acquisition.dependencyProjection.bundledDependencies',
    'must be dense and have no extra fields',
    ['recipes', 1, 'acquisition', 'dependencyProjection', 'bundledDependencies'],
    new Array<unknown>(1),
  ),
  directMutation(
    'invalid bundled dependency name',
    'catalog.recipes[1].acquisition.dependencyProjection.bundledDependencies[0]',
    'invalid package name',
    ['recipes', 1, 'acquisition', 'dependencyProjection', 'bundledDependencies', 0],
    'scope/pkg',
  ),
  mutation(
    'duplicate bundled dependency',
    'catalog.recipes[1].acquisition.dependencyProjection.bundledDependencies',
    'duplicate member or non-canonical ordering',
    (catalog) => {
      const bundled = recordAt(catalog, [
        'recipes',
        1,
        'acquisition',
        'dependencyProjection',
      ]).bundledDependencies;
      if (!Array.isArray(bundled)) throw new Error('fixture bundled dependencies are missing');
      bundled.push('napi-wasm');
      resign(catalog);
    },
  ),
  mutation(
    'unretained bundled dependency',
    'catalog.recipes[1].acquisition.dependencyProjection.bundledDependencies[0]',
    'bundled package must be retained by dependencies or optionalDependencies',
    (catalog) => {
      setAt(
        catalog,
        ['recipes', 1, 'acquisition', 'dependencyProjection', 'bundledDependencies', 0],
        '@contract/missing',
      );
      resign(catalog);
    },
  ),
  directMutation(
    'sparse materialization files',
    'catalog.recipes[0].materialization.files',
    'must be dense and have no extra fields',
    ['recipes', 0, 'materialization', 'files'],
    new Array<unknown>(1),
  ),
  directMutation(
    'sparse catalog assets',
    'catalog.assets',
    'must be dense and have no extra fields',
    ['assets'],
    new Array<unknown>(1),
  ),
  directMutation(
    'escaping materialization path',
    'catalog.recipes[0].materialization.files[0].path',
    'must be a normalized relative path',
    ['recipes', 0, 'materialization', 'files', 0, 'path'],
    '../escape',
  ),
  mutation(
    'file content identity drift',
    'catalog.recipes[0].materialization.files[0]',
    'content identity mismatch',
    (catalog) => {
      const file = catalog.recipes[0]!.materialization.files[0]!;
      Reflect.set(file, 'bytes', file.bytes + 1);
    },
  ),
  mutation(
    'duplicate materialization file',
    'catalog.recipes[0].materialization.files',
    'duplicate path or non-canonical ordering',
    (catalog) => {
      const files = catalog.recipes[0]!.materialization.files;
      files.push(structuredClone(files[1]!));
      resign(catalog);
    },
  ),
  mutation(
    'non-canonical materialization file order',
    'catalog.recipes[0].materialization.files',
    'duplicate path or non-canonical ordering',
    (catalog) => {
      catalog.recipes[0]!.materialization.files.reverse();
      resign(catalog);
    },
  ),
  directMutation(
    'non-record materialization bin',
    'catalog.recipes[0].materialization.bin',
    'must be a plain object',
    ['recipes', 0, 'materialization', 'bin'],
    [],
  ),
  directMutation(
    'invalid bin command',
    'catalog.recipes[0].materialization.bin.scope/cmd',
    'invalid bin command',
    ['recipes', 0, 'materialization', 'bin', 'scope/cmd'],
    'bin/esbuild',
  ),
  mutation(
    'escaping bin target',
    'catalog.recipes[0].materialization.bin.esbuild',
    'must be a normalized relative path',
    (catalog) => {
      setAt(catalog, ['recipes', 0, 'materialization', 'bin', 'esbuild'], '../escape');
      resign(catalog);
    },
  ),
  mutation(
    'missing bin target',
    'catalog.recipes[0].materialization.bin.esbuild',
    'target bin/missing is missing from materialization files',
    (catalog) => {
      setAt(catalog, ['recipes', 0, 'materialization', 'bin', 'esbuild'], 'bin/missing');
      resign(catalog);
    },
  ),
  mutation(
    'missing package manifest',
    'catalog.recipes[0].materialization.files',
    'package.json is missing',
    (catalog) => {
      catalog.recipes[0]!.materialization.files.pop();
      resign(catalog);
    },
  ),
  mutation(
    'invalid package manifest JSON',
    'catalog.recipes[0].materialization.files.package.json',
    'invalid JSON',
    (catalog) => {
      const files = catalog.recipes[0]!.materialization.files;
      const index = files.findIndex((file) => file.path === 'package.json');
      if (index === -1) throw new Error('fixture package.json is missing');
      files[index] = rawFile('package.json', '{');
      resign(catalog);
    },
  ),
  mutation(
    'package identity disagreement',
    'catalog.recipes[0].materialization.files.package.json',
    'package identity disagrees with materialization',
    (catalog) => {
      replacePackageManifest(catalog, 0, {
        name: '@contract/other',
        version: '0.28.0',
        bin: { esbuild: './bin/esbuild' },
      });
      resign(catalog);
    },
  ),
  mutation(
    'package bin disagreement',
    'catalog.recipes[0].materialization.files.package.json.bin',
    'package bin disagrees with materialization',
    (catalog) => {
      replacePackageManifest(catalog, 0, {
        name: 'esbuild',
        version: '0.28.0',
        bin: { esbuild: './bin/other' },
      });
      resign(catalog);
    },
  ),
  directMutation(
    'sparse binding assets',
    'catalog.recipes[0].binding.assets',
    'must be dense and have no extra fields',
    ['recipes', 0, 'binding', 'assets'],
    new Array<unknown>(1),
  ),
  mutation(
    'duplicate binding asset',
    'catalog.recipes[0].binding.assets',
    'duplicate member or non-canonical ordering',
    (catalog) => {
      const assets = recordAt(catalog, ['recipes', 0, 'binding']).assets;
      if (!Array.isArray(assets)) throw new Error('fixture binding assets are missing');
      assets.push(assets[0]);
      resign(catalog);
    },
  ),
  mutation(
    'unknown binding asset',
    'catalog.recipes[0].binding.assets',
    'unknown asset contract.unknown-runtime.v1',
    (catalog) => {
      setAt(catalog, ['recipes', 0, 'binding', 'assets', 0], 'contract.unknown-runtime.v1');
      resign(catalog);
    },
  ),
  directMutation(
    'invalid asset integrity',
    'catalog.assets[0].source.integrity',
    'non-canonical or wrong-length digest',
    ['assets', 0, 'source', 'integrity'],
    'sha512-AA==',
  ),
  directMutation(
    'invalid asset member path',
    'catalog.assets[0].member',
    'must be a normalized relative path',
    ['assets', 0, 'member'],
    '/absolute',
  ),
  mutation(
    'duplicate catalog asset identity',
    'catalog.assets',
    'duplicate identity or non-canonical ordering',
    (catalog) => {
      catalog.assets.push(structuredClone(catalog.assets[0]!));
      resign(catalog);
    },
  ),
  mutation(
    'recipe digest drift',
    'catalog.recipes[0].digest',
    'recipe digest mismatch',
    (catalog) => {
      Reflect.set(catalog.recipes[0]!, 'digest', '0'.repeat(64));
    },
  ),
  mutation('catalog digest drift', 'catalog.digest', 'catalog digest mismatch', (catalog) => {
    Reflect.set(catalog, 'digest', '0'.repeat(64));
  }),
];

describe('shadow recipe v2 data authority', () => {
  it('strict-decodes canonical and cloned schema 2 to equal deeply frozen policy', () => {
    const canonical = decodeShadowSubstitutionCatalog(rawSchema2Catalog());
    const cloned = decodeShadowSubstitutionCatalog(structuredClone(rawSchema2Catalog()));

    expect(cloned).toEqual(canonical);
    expect(canonical.schema).toBe(2);
    expectDeepFrozen(canonical);
    expectDeepFrozen(cloned);
  });

  it('keeps exact registry evidence independent while builtin policy preserves its owned projection', () => {
    expect(lightningRegistryGolden).toEqual({
      name: 'lightningcss-wasm',
      version: '1.32.0',
      dist: {
        integrity:
          'sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ==',
      },
      dependencies: { 'napi-wasm': '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: ['napi-wasm'],
    });
    const lightning = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'lightningcss',
    );
    if (!lightning || lightning.acquisition.kind !== 'registry') {
      throw new Error('builtin LightningCSS recipe is missing');
    }
    expect(recordAt(lightning.acquisition, ['dependencyProjection'])).toEqual({
      dependencies: lightningRegistryGolden.dependencies,
      optionalDependencies: lightningRegistryGolden.optionalDependencies,
      omittedOptionalDependencies: {},
      peerDependencies: lightningRegistryGolden.peerDependencies,
      bundledDependencies: lightningRegistryGolden.bundleDependencies,
      unsupportedFeature: 'lightningcss.acquisition',
    });
  });

  it('pins the exact LightningCSS tarball and its complete embedded package independently', () => {
    expect(lightningTarballGolden).toEqual({
      name: 'lightningcss-wasm',
      version: '1.32.0',
      tarball: {
        bytes: 3_821_302,
        sha256: 'ea1419e577dd943907c7e17a99fa7a76143d99c6279a6131e79fb4b1b098ac89',
        integrity:
          'sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ==',
      },
      packageJson: {
        path: 'package/package.json',
        bytes: 1_186,
        sha256: 'b7f16ae6a0036f2d92a22efdfff34482ec6b9ef33c519b8c0e858dbf2d403410',
      },
      embeddedPackages: [
        {
          name: 'napi-wasm',
          version: '1.1.3',
          root: 'package/node_modules/napi-wasm',
          members: [
            {
              path: 'package/node_modules/napi-wasm/README.md',
              bytes: 4_246,
              sha256: 'e646406048bd592d66f5a4deeadb41ab5071ee051a530a7346f7ed2eb520e8e1',
            },
            {
              path: 'package/node_modules/napi-wasm/index.js',
              bytes: 42_418,
              sha256: 'ad46aa59b86c852819ba521cdbde18348467e448ce4e466e83e53ea60896bc8d',
            },
            {
              path: 'package/node_modules/napi-wasm/index.mjs',
              bytes: 42_375,
              sha256: '0108dc67b01e6f4e8493720a51f58747f5318ff13294bb4636fce108515e0101',
            },
            {
              path: 'package/node_modules/napi-wasm/package.json',
              bytes: 810,
              sha256: '979a10d090dc49549d31ee206b60863950712145a3bebf9fe21a0919e8ca77a1',
            },
          ],
        },
      ],
    });
    expect(lightningTarballGolden.tarball.integrity).toBe(lightningRegistryGolden.dist.integrity);
    expect(lightningTarballGolden.embeddedPackages.map(({ name }) => name)).toEqual(
      lightningRegistryGolden.bundleDependencies,
    );
  });

  it('exports one owner-decoded builtin object and no generic decoder through a package barrel', () => {
    expect(internalShadowRegistry.builtinShadowSubstitutionCatalog).toBe(
      builtinShadowSubstitutionCatalog,
    );
    expect(rootShadowRegistry).not.toHaveProperty('decodeShadowSubstitutionCatalog');
    expect(internalShadowRegistry).not.toHaveProperty('decodeShadowSubstitutionCatalog');
  });

  it('keeps generic shape decoding separate from builtin identity admission', () => {
    const foreign = rawSchema2Catalog();
    expect(decodeShadowSubstitutionCatalog(foreign)).toEqual(foreign);
    expect(captureRunFailure(() => decodeBuiltinShadowSubstitutionCatalog(foreign))).toEqual(
      expectedFailure('catalog', 'not the admitted builtin catalog identity'),
    );
  });

  it('strict-decodes exact-only admission as data without a builtin exact-only recipe', () => {
    const catalog = rawSchema2Catalog();
    setAt(catalog, ['recipes', 0, 'admission', 'kind'], 'exact-only');
    resign(catalog);

    expect(decodeShadowSubstitutionCatalog(catalog)).toEqual(catalog);
  });

  it('ships both builtin siblings as schema 2 with data-owned admission features', () => {
    expect(builtinShadowSubstitutionCatalog).toMatchObject({
      schema: 2,
      id: 'rifty.shadow-substitutions.builtin.v2',
    });
    expect(
      builtinShadowSubstitutionCatalog.recipes.map((recipe) => ({
        id: recipe.id,
        schema: recipe.schema,
        admission: recordAt(recipe, ['admission']),
      })),
    ).toEqual([
      {
        id: 'rifty.shadow-substitution.esbuild.v2',
        schema: 2,
        admission: { kind: 'semver-admits', unsupportedFeature: 'esbuild.version' },
      },
      {
        id: 'rifty.shadow-substitution.lightningcss.v2',
        schema: 2,
        admission: { kind: 'semver-admits', unsupportedFeature: 'lightningcss.version' },
      },
    ]);
  });

  it('accepts scoped package keys and ASCII prerelease versions in every package/version field', () => {
    const catalog = rawSchema2Catalog();
    setAt(catalog, ['recipes', 1, 'trigger', 'name'], '@scope/trigger');
    setAt(catalog, ['recipes', 1, 'trigger', 'version'], '1.32.0-next.1');
    setAt(catalog, ['recipes', 1, 'acquisition', 'name'], '@scope/acquired');
    setAt(catalog, ['recipes', 1, 'acquisition', 'version'], '1.32.0-next.1');
    setAt(catalog, ['recipes', 1, 'materialization', 'name'], '@scope/materialized');
    setAt(catalog, ['recipes', 1, 'materialization', 'version'], '1.32.0-next.1');
    setAt(catalog, ['assets', 0, 'source', 'name'], '@scope/asset');
    setAt(catalog, ['assets', 0, 'source', 'version'], '0.28.0-next.1');
    const dependencies = recordAt(catalog, [
      'recipes',
      1,
      'acquisition',
      'dependencyProjection',
      'dependencies',
    ]);
    Reflect.deleteProperty(dependencies, 'napi-wasm');
    Reflect.set(dependencies, '@scope/dependency', '^1.0.1');
    setAt(
      catalog,
      ['recipes', 1, 'acquisition', 'dependencyProjection', 'bundledDependencies', 0],
      '@scope/dependency',
    );
    replacePackageManifest(catalog, 1, {
      name: '@scope/materialized',
      version: '1.32.0-next.1',
    });
    resign(catalog);

    expect(decodeShadowSubstitutionCatalog(catalog)).toEqual(catalog);
  });

  it('normalizes package.json string-bin shorthand only for agreement checking', () => {
    const catalog = rawSchema2Catalog();
    replacePackageManifest(catalog, 0, {
      name: 'esbuild',
      version: '0.28.0',
      bin: './bin/esbuild',
    });
    resign(catalog);

    expect(decodeShadowSubstitutionCatalog(catalog)).toEqual(catalog);
  });

  it.each(DATA_MUTATIONS)(
    'rejects $label with the same exact tuple before and after structured clone',
    ({ path, detail, forge }) => {
      const canonical = rawSchema2Catalog();
      forge(canonical);
      const expected = expectedFailure(path, detail);

      expect(captureFailure(canonical)).toEqual(expected);
      expect(captureFailure(structuredClone(canonical))).toEqual(expected);
    },
  );

  it.each([
    ['catalog record', 'catalog', [] as const, 'digest'],
    ['recipe record', 'catalog.recipes[0]', ['recipes', 0] as const, 'id'],
    ['trigger record', 'catalog.recipes[0].trigger', ['recipes', 0, 'trigger'] as const, 'version'],
    [
      'admission record',
      'catalog.recipes[0].admission',
      ['recipes', 0, 'admission'] as const,
      'kind',
    ],
    [
      'synthetic acquisition record',
      'catalog.recipes[0].acquisition',
      ['recipes', 0, 'acquisition'] as const,
      'kind',
    ],
    [
      'registry acquisition record',
      'catalog.recipes[1].acquisition',
      ['recipes', 1, 'acquisition'] as const,
      'kind',
    ],
    [
      'dependency projection record',
      'catalog.recipes[1].acquisition.dependencyProjection',
      ['recipes', 1, 'acquisition', 'dependencyProjection'] as const,
      'unsupportedFeature',
    ],
    [
      'projection map',
      'catalog.recipes[1].acquisition.dependencyProjection.dependencies',
      ['recipes', 1, 'acquisition', 'dependencyProjection', 'dependencies'] as const,
      'napi-wasm',
    ],
    [
      'materialization record',
      'catalog.recipes[0].materialization',
      ['recipes', 0, 'materialization'] as const,
      'version',
    ],
    [
      'materialization bin record',
      'catalog.recipes[0].materialization.bin',
      ['recipes', 0, 'materialization', 'bin'] as const,
      'esbuild',
    ],
    [
      'materialization file record',
      'catalog.recipes[0].materialization.files[0]',
      ['recipes', 0, 'materialization', 'files', 0] as const,
      'path',
    ],
    [
      'binding record',
      'catalog.recipes[0].binding',
      ['recipes', 0, 'binding'] as const,
      'adapterId',
    ],
    ['asset record', 'catalog.assets[0]', ['assets', 0] as const, 'member'],
    [
      'asset source record',
      'catalog.assets[0].source',
      ['assets', 0, 'source'] as const,
      'integrity',
    ],
  ])('rejects a $0 accessor without invoking it', (_label, path, targetPath, key) => {
    const catalog = rawSchema2Catalog();
    const target = recordAt(catalog, targetPath);
    let getterCalls = 0;
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });

    expect(captureFailure(catalog)).toEqual(expectedFailure(path, 'accessors are forbidden'));
    expect(getterCalls).toBe(0);
  });

  it.each([
    ['recipes', 'catalog.recipes', ['recipes'] as const],
    ['catalog assets', 'catalog.assets', ['assets'] as const],
    [
      'materialization files',
      'catalog.recipes[0].materialization.files',
      ['recipes', 0, 'materialization', 'files'] as const,
    ],
    [
      'bundled dependencies',
      'catalog.recipes[1].acquisition.dependencyProjection.bundledDependencies',
      ['recipes', 1, 'acquisition', 'dependencyProjection', 'bundledDependencies'] as const,
    ],
    [
      'binding assets',
      'catalog.recipes[0].binding.assets',
      ['recipes', 0, 'binding', 'assets'] as const,
    ],
  ])('rejects an accessor element in $0 without invoking it', (_label, path, targetPath) => {
    const catalog = rawSchema2Catalog();
    const target = recordAt(catalog, targetPath);
    const original = Reflect.get(target, 0);
    let getterCalls = 0;
    Object.defineProperty(target, 0, {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return original;
      },
    });

    expect(captureFailure(catalog)).toEqual(
      expectedFailure(path, 'element 0 must be a data property'),
    );
    expect(getterCalls).toBe(0);
  });
});
