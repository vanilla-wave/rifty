import { describe, expect, it } from 'vitest';
import { type Starter, seedFilesForStarter, starterFromPreset } from '../glue/starter.ts';
import type { PresetSetup } from '../presets.ts';
import { PRESETS } from '../presets.ts';
import type { ProjectSpec } from '../templates/project-spec.ts';
import { projectScripts, terminalDevLine } from '../templates/project-spec.ts';
import { allProjectSpecs, resolveProjectSpec } from '../templates/registry.ts';
import type { PlaygroundProjectPlan } from '../workbench/playground.ts';
import { toPlaygroundProjectPlan } from './playground-project-plan.ts';

const SENTINEL_ROOT = '/__playground_plan_contract__';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function syntheticStarter(spec: ProjectSpec): Starter {
  return {
    id: `starter-${spec.id}`,
    name: `Starter ${spec.id}`,
    starter: `starter-${spec.id}`,
    templateId: spec.id,
    files: [
      {
        path: spec.entry.relativePath,
        content: spec.entry.content,
      },
    ],
  };
}

function mapPlan(input: {
  readonly projectId: string;
  readonly starter: Starter;
  readonly setup: PresetSetup;
}): PlaygroundProjectPlan {
  return toPlaygroundProjectPlan(input);
}

function projectRootedSeedFiles(starter: Starter): Readonly<Record<string, string>> {
  const rooted = seedFilesForStarter(starter, SENTINEL_ROOT);
  const stripped: Record<string, string> = {};
  for (const [path, contents] of Object.entries(rooted)) {
    if (!path.startsWith(`${SENTINEL_ROOT}/`)) {
      throw new Error(`seed escaped sentinel root: ${path}`);
    }
    stripped[path.slice(SENTINEL_ROOT.length)] = contents;
  }
  return stripped;
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

function text(value: string | Uint8Array | undefined, path: string): string {
  if (value === undefined) throw new Error(`missing plan file ${path}`);
  return typeof value === 'string' ? value : decoder.decode(value);
}

function expectExactSeedBytes(plan: PlaygroundProjectPlan, starter: Starter): void {
  const expected = projectRootedSeedFiles(starter);
  expect(Object.keys(plan.files).sort()).toEqual(Object.keys(expected).sort());
  for (const [path, contents] of Object.entries(expected)) {
    const actual = plan.files[path];
    if (actual === undefined) throw new Error(`missing plan file ${path}`);
    expect(bytes(actual), path).toEqual(encoder.encode(contents));
  }
  for (const path of Object.keys(plan.files)) {
    expect(path, path).toMatch(/^\/(?!\/)/);
    expect(path, path).not.toContain(SENTINEL_ROOT);
  }
}

function expectedPlanKeys(spec: ProjectSpec): readonly string[] {
  const keys = [
    'dependencies',
    'files',
    'firstMaterialization',
    'id',
    'kind',
    'starterId',
    'templateId',
  ];
  if (spec.devDependencies !== undefined) keys.push('devDependencies');
  if (spec.runtime === 'vite') keys.push('port');
  if (spec.runtime === 'node-server') keys.push('entryPath', 'port');
  if (spec.runtime === 'node-cli') keys.push('args', 'entryPath');
  return keys.sort();
}

function expectRuntimeContract(plan: PlaygroundProjectPlan, spec: ProjectSpec): void {
  expect(plan.kind).toBe(spec.runtime);
  expect(Reflect.ownKeys(plan).map(String).sort()).toEqual(expectedPlanKeys(spec));

  if (plan.kind === 'vite') {
    expect(spec.runtime).toBe('vite');
    expect(plan.port).toBe(spec.defaultPort);
    expect(`vite --port ${String(plan.port)}`).toBe(terminalDevLine(spec, SENTINEL_ROOT));
    expect('entryPath' in plan).toBe(false);
    expect('args' in plan).toBe(false);
    expect('viteVersion' in plan).toBe(false);
    return;
  }

  expect(plan.entryPath).toBe(spec.entry.relativePath);
  expect(terminalDevLine(spec, SENTINEL_ROOT)).toBe(`cd ${SENTINEL_ROOT} && npm run dev`);
  if (plan.kind === 'node-server') {
    expect(spec.runtime).toBe('node-server');
    expect(plan.port).toBe(spec.defaultPort);
    expect('args' in plan).toBe(false);
    return;
  }

  expect(spec.runtime).toBe('node-cli');
  expect(plan.args).toEqual([]);
  expect('port' in plan).toBe(false);
}

function expectManifestContract(plan: PlaygroundProjectPlan, spec: ProjectSpec): void {
  const manifestText = text(plan.files['/package.json'], '/package.json');
  const manifest = JSON.parse(manifestText) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly scripts?: Readonly<Record<string, string>>;
  };

  expect(plan.dependencies).toEqual(spec.install);
  expect(manifest.dependencies).toEqual(spec.install);
  expect(manifest.scripts).toEqual(projectScripts(spec));
  if (spec.devDependencies === undefined) {
    expect('devDependencies' in plan).toBe(false);
    expect(Object.hasOwn(manifest, 'devDependencies')).toBe(false);
  } else {
    expect(plan.devDependencies).toEqual(spec.devDependencies);
    expect(manifest.devDependencies).toEqual(spec.devDependencies);
  }
}

function expectNoProductOrUiFields(plan: PlaygroundProjectPlan): void {
  for (const field of [
    'starter',
    'name',
    'displayName',
    'label',
    'category',
    'icon',
    'mode',
    'setup',
    'blurb',
    'glyph',
    'tag',
    'openFiles',
    'estimatedBootSeconds',
    'bakedNodeModulesUrl',
    'bakedNodeModulesSnapshotId',
    'bakedNodeModulesTemplateId',
  ]) {
    expect(plan, field).not.toHaveProperty(field);
  }
}

function expectCloneSafe(value: unknown, path = 'plan'): void {
  expect(['bigint', 'function', 'symbol']).not.toContain(typeof value);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (value instanceof Uint8Array) {
    expect(Object.getPrototypeOf(value), `${path} prototype`).toBe(Uint8Array.prototype);
    const expectedKeys = Array.from({ length: value.length }, (_unused, index) => String(index));
    expect(Reflect.ownKeys(value), `${path} exact byte-view keys`).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) throw new Error(`missing descriptor at ${path}.${key}`);
      expect(descriptor.enumerable, `${path}.${key} enumerable`).toBe(true);
      expect(descriptor.get, `${path}.${key} getter`).toBeUndefined();
      expect(descriptor.set, `${path}.${key} setter`).toBeUndefined();
      expectCloneSafe(descriptor.value, `${path}.${key}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value), `${path} prototype`).toBe(Array.prototype);
    const expectedIndexKeys = Array.from({ length: value.length }, (_unused, index) =>
      String(index),
    );
    expect(Reflect.ownKeys(value), `${path} exact array keys`).toEqual([
      ...expectedIndexKeys,
      'length',
    ]);
    for (const key of expectedIndexKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) throw new Error(`missing descriptor at ${path}[${key}]`);
      expect(descriptor.enumerable, `${path}[${key}] enumerable`).toBe(true);
      expect(descriptor.get, `${path}[${key}] getter`).toBeUndefined();
      expect(descriptor.set, `${path}[${key}] setter`).toBeUndefined();
      expectCloneSafe(descriptor.value, `${path}[${key}]`);
    }
    return;
  }
  if (typeof value !== 'object') throw new Error(`not clone-safe at ${path}`);

  const prototype = Object.getPrototypeOf(value);
  expect([Object.prototype, null], path).toContain(prototype);
  for (const key of Reflect.ownKeys(value)) {
    expect(typeof key, `${path} symbol key`).toBe('string');
    if (typeof key !== 'string') throw new Error(`symbol key at ${path}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) throw new Error(`missing descriptor at ${path}.${key}`);
    expect(descriptor.enumerable, `${path}.${key} enumerable`).toBe(true);
    expect(descriptor.get, `${path}.${key} getter`).toBeUndefined();
    expect(descriptor.set, `${path}.${key} setter`).toBeUndefined();
    expectCloneSafe(descriptor.value, `${path}.${key}`);
  }
}

function expectStructuredClone(plan: PlaygroundProjectPlan): void {
  expectCloneSafe(plan);
  const clone = structuredClone(plan);
  expect(clone).toEqual(plan);
  expect(clone).not.toBe(plan);
  expect(clone.files).not.toBe(plan.files);
  expect(clone.dependencies).not.toBe(plan.dependencies);
}

describe('toPlaygroundProjectPlan registry differential contract', () => {
  it.each(allProjectSpecs().map((spec) => [spec.id, spec] as const))(
    'preserves every registered %s template as exact project-rooted seed bytes',
    (_templateId, spec) => {
      const starter = syntheticStarter(spec);
      const projectId = `durable-project-${spec.id}`;
      const plan = mapPlan({ projectId, starter, setup: 'from-scratch' });

      expect(plan.id).toBe(projectId);
      expect(plan.starterId).toBe(starter.id);
      expect(plan.templateId).toBe(spec.id);
      expect(plan.templateId).not.toBe(plan.id);
      expect(plan.firstMaterialization).toEqual({ kind: 'install' });
      expectExactSeedBytes(plan, starter);
      expectRuntimeContract(plan, spec);
      expectManifestContract(plan, spec);
      expectNoProductOrUiFields(plan);
      expectStructuredClone(plan);
    },
  );

  it('uses Starter files as ordinary overlays on the complete template seed', () => {
    const spec = resolveProjectSpec('vite');
    const starter: Starter = {
      id: 'overlay-contract',
      name: 'UI-only starter name',
      starter: 'overlay-contract',
      templateId: spec.id,
      files: [
        { path: spec.entry.relativePath, content: '// preset entry overlay\n' },
        { path: '/README.md', content: 'preset-only file\n' },
        { path: 'index.html', content: '<main>preset html overlay</main>\n' },
      ],
    };

    const plan = mapPlan({ projectId: 'overlay-project', starter, setup: 'from-scratch' });

    expectExactSeedBytes(plan, starter);
    expect(text(plan.files['/src/main.js'], '/src/main.js')).toBe('// preset entry overlay\n');
    expect(text(plan.files['/README.md'], '/README.md')).toBe('preset-only file\n');
    expect(text(plan.files['/index.html'], '/index.html')).toBe(
      '<main>preset html overlay</main>\n',
    );
    expect(text(plan.files['/package.json'], '/package.json')).toContain('"vite"');
  });

  it('rejects a Starter whose durable self-id disagrees with its registry id', () => {
    const starter = syntheticStarter(resolveProjectSpec('vite'));

    expect(() =>
      mapPlan({
        projectId: 'starter-provenance-mismatch',
        starter: { ...starter, starter: 'different-starter' },
        setup: 'from-scratch',
      }),
    ).toThrow(/starter.*(id|identity)|identity.*starter/i);
  });
});

describe('toPlaygroundProjectPlan preset policy differential contract', () => {
  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'maps preset %s without carrying its UI model across the companion seam',
    (_presetId, preset) => {
      const starter = starterFromPreset(preset);
      const spec = resolveProjectSpec(starter.templateId ?? 'vite');
      const projectId = `catalog-project-${preset.id}`;
      const plan = mapPlan({ projectId, starter, setup: preset.setup });

      expect(plan.id).toBe(projectId);
      expect(plan.starterId).toBe(starter.id);
      expect(plan.templateId).toBe(spec.id);
      expect(plan.templateId).not.toBe(plan.id);
      expectExactSeedBytes(plan, starter);
      expectRuntimeContract(plan, spec);
      expectManifestContract(plan, spec);
      expectNoProductOrUiFields(plan);
      expectStructuredClone(plan);

      if (preset.setup === 'instant') {
        if (spec.bakedNodeModulesUrl === undefined) {
          throw new Error(`instant preset ${preset.id} lacks a baked snapshot fixture`);
        }
        if (spec.bakedNodeModulesSnapshotId === undefined) {
          throw new Error(`instant preset ${preset.id} lacks bake-owned snapshot identity`);
        }
        const snapshotTemplateId = spec.bakedNodeModulesTemplateId ?? spec.id;
        expect(plan.firstMaterialization).toEqual({
          kind: 'snapshot',
          snapshot: {
            snapshotId: spec.bakedNodeModulesSnapshotId,
            assetUrl: spec.bakedNodeModulesUrl,
            templateId: snapshotTemplateId,
          },
        });
      } else {
        expect(plan.firstMaterialization).toEqual({ kind: 'install' });
        expect(plan.firstMaterialization).not.toHaveProperty('snapshot');
      }
    },
  );

  it('keeps from-scratch on the install path even when its template has a baked snapshot', () => {
    const preset = PRESETS.find((candidate) => {
      if (candidate.setup !== 'from-scratch') return false;
      const spec = resolveProjectSpec(candidate.templateId ?? 'vite');
      return spec.bakedNodeModulesUrl !== undefined;
    });
    if (preset === undefined) throw new Error('missing from-scratch snapshot-backed fixture');
    const spec = resolveProjectSpec(preset.templateId ?? 'vite');

    const plan = mapPlan({
      projectId: `from-scratch-${preset.id}`,
      starter: starterFromPreset(preset),
      setup: 'from-scratch',
    });

    expect(spec.bakedNodeModulesUrl).toBeDefined();
    expect(plan.firstMaterialization).toEqual({ kind: 'install' });
    expect(plan.firstMaterialization).not.toHaveProperty('snapshot');
  });

  it.each(
    allProjectSpecs()
      .filter((spec) => spec.bakedNodeModulesUrl === undefined)
      .map((spec) => [spec.id, spec] as const),
  )('rejects instant for snapshot-less template %s', (_templateId, spec) => {
    expect(() =>
      mapPlan({
        projectId: `instant-${spec.id}`,
        starter: syntheticStarter(spec),
        setup: 'instant',
      }),
    ).toThrow(/instant.*snapshot|snapshot.*instant/i);
  });

  it('keeps bake provenance separate when a template shares another snapshot tree', () => {
    const spec = resolveProjectSpec('vite');
    const descriptor = Object.getOwnPropertyDescriptor(spec, 'bakedNodeModulesTemplateId');
    const snapshotTemplateId = 'shared-vite-dependency-tree';
    Object.defineProperty(spec, 'bakedNodeModulesTemplateId', {
      configurable: true,
      enumerable: true,
      value: snapshotTemplateId,
      writable: true,
    });

    try {
      const plan = mapPlan({
        projectId: 'snapshot-template-alias-project',
        starter: syntheticStarter(spec),
        setup: 'instant',
      });

      expect(plan.templateId).toBe(spec.id);
      if (spec.bakedNodeModulesSnapshotId === undefined) {
        throw new Error('vite fixture lacks bake-owned snapshot identity');
      }
      expect(plan.firstMaterialization).toEqual({
        kind: 'snapshot',
        snapshot: {
          snapshotId: spec.bakedNodeModulesSnapshotId,
          assetUrl: spec.bakedNodeModulesUrl,
          templateId: snapshotTemplateId,
        },
      });
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(spec, 'bakedNodeModulesTemplateId');
      else Object.defineProperty(spec, 'bakedNodeModulesTemplateId', descriptor);
    }
  });
});
