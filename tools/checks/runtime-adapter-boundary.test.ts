import { describe, expect, it } from 'vitest';
import * as runtimeAdapterBoundary from './runtime-adapter-boundary.mjs';

const { GENERIC_RUNTIME_ADAPTER_MODULES, runtimeAdapterBoundaryViolations } =
  runtimeAdapterBoundary;

const EXPECTED_GENERIC_RUNTIME_ADAPTER_MODULES = Object.freeze([
  'packages/npm-client/src/installer.ts',
  'packages/npm-client/src/linker.ts',
  'packages/npm-client/src/internal/shadow/admission.ts',
  'packages/npm-client/src/internal/shadow/planner.ts',
  'packages/npm-client/src/internal/shadow/manager.ts',
  'packages/npm-client/src/internal/shadow/port.ts',
  'packages/workbench/src/workers/package-acquisition-authority.ts',
  'packages/workbench/src/workers/owner-package-state.ts',
  'packages/workbench/src/workers/owner-child-admission.ts',
  'packages/workbench/src/workers/owner-shadow-assets.ts',
  'packages/workbench/src/workers/workbench-project-runtime.ts',
  'packages/workbench/src/workers/workbench-owner-controller.ts',
  'packages/workbench/src/workers/owner-child-node-executor.ts',
  'packages/workbench/src/workers/owner-child-bin-executor.ts',
  'packages/workbench/src/workers/owner-child-dev-server.ts',
  'packages/workbench/src/workers/node-entry-bootstrap.ts',
  'packages/workbench/src/workers/node-entry-runtime-preparation.ts',
] as const);

const EXPECTED_SASS_FORBIDDEN_SURFACE = Object.freeze({
  catalogConsumers: EXPECTED_GENERIC_RUNTIME_ADAPTER_MODULES,
  registrySourceProvenance: Object.freeze([
    'packages/npm-client/src/registry.ts',
    'packages/npm-client/src/internal/shadow/source.ts',
    'packages/npm-client/src/installer.ts',
    'packages/npm-client/src/linker.ts',
    'packages/npm-client/src/internal/shadow/planner.ts',
  ]),
  vfs: Object.freeze(['packages/vfs/src']),
  kernelRuntime: Object.freeze([
    'packages/kernel/src',
    'packages/runtime-js/src',
    'packages/runtime-wasi/src',
  ]),
  workbench: Object.freeze(['packages/workbench/src']),
  managerStoreMessagePort: Object.freeze([
    'packages/npm-client/src/internal/shadow/manager.ts',
    'packages/npm-client/src/internal/shadow/port.ts',
    'packages/workbench/src/workers/owner-shadow-assets.ts',
    'packages/workbench/src/workers/owner-storage.ts',
    'packages/workbench/src/workers/workbench-owner-storage.ts',
  ]),
  esbuildAdapter: Object.freeze([
    'packages/workbench/src/workers/workbench-runtime-adapters.ts',
    'packages/workbench/src/workers/esbuild-runtime-fs.ts',
    'packages/workbench/src/workers/vite-esbuild-runtime.ts',
  ]),
});

const boundaryContract = runtimeAdapterBoundary as typeof runtimeAdapterBoundary & {
  readonly SASS_FORBIDDEN_SURFACE?: unknown;
};

describe('runtime adapter generic-module boundary', () => {
  it('lists the finite generic plan/admission/launch surface', () => {
    expect(GENERIC_RUNTIME_ADAPTER_MODULES).toEqual(EXPECTED_GENERIC_RUNTIME_ADAPTER_MODULES);
  });

  it('freezes the separate Sass-forbidden registry-to-runtime surface', () => {
    const surface = boundaryContract.SASS_FORBIDDEN_SURFACE;
    expect(surface).toEqual(EXPECTED_SASS_FORBIDDEN_SURFACE);
    expect(Object.isFrozen(surface)).toBe(true);
    if (surface === null || typeof surface !== 'object') {
      throw new TypeError('Sass-forbidden surface must be an object');
    }
    for (const paths of Object.values(surface)) {
      expect(Object.isFrozen(paths)).toBe(true);
    }
  });

  it('permits concrete-edge imports but rejects runtime literals and conditions', () => {
    expect(
      runtimeAdapterBoundaryViolations(
        'generic.ts',
        `import { prepareVite } from './vite-edge.ts';
prepareVite(input);
`,
      ),
    ).toEqual([]);
    expect(
      runtimeAdapterBoundaryViolations(
        'generic.ts',
        `if (isViteEntry(input)) activate('esbuild@0.28.0');`,
      ),
    ).toEqual([
      'generic.ts:1: consumer-specific identifier in a generic control-flow condition',
      'generic.ts:1: consumer-specific runtime literal "esbuild@0.28.0"',
    ]);
    expect(
      runtimeAdapterBoundaryViolations(
        'generic.ts',
        `if (isSassEmbedded(input)) activate('sass-embedded@1.100.0');`,
      ),
    ).toEqual([
      'generic.ts:1: consumer-specific identifier in a generic control-flow condition',
      'generic.ts:1: consumer-specific runtime literal "sass-embedded@1.100.0"',
    ]);
  });

  it.each([
    {
      label: 'an aliased Sass predicate feeding generic control flow',
      source: `const match = isSassEmbedded(input);
if (match) activate(recipe);
`,
      violations: ['generic.ts:1: consumer-specific runtime identifier "isSassEmbedded"'],
    },
    {
      label: 'a named Sass recipe outside a condition',
      source: `const recipe = SASS_EMBEDDED_RECIPE;
activate(recipe);
`,
      violations: ['generic.ts:1: consumer-specific runtime identifier "SASS_EMBEDDED_RECIPE"'],
    },
    {
      label: 'a split Sass runtime literal',
      source: `const recipe = 'sa' + 'ss-embedded@1.100.0';
activate(recipe);
`,
      violations: ['generic.ts:1: consumer-specific runtime literal "sass-embedded@1.100.0"'],
    },
  ])('rejects $label', ({ source, violations }) => {
    expect(runtimeAdapterBoundaryViolations('generic.ts', source)).toEqual(violations);
  });

  it('rejects remaining concrete recipe names and Vite entry kind in generic source', () => {
    expect(
      runtimeAdapterBoundaryViolations(
        'generic.ts',
        `const recipes = ['lightningcss-wasm', 'napi-wasm', 'sass-embedded'];
if (entry.kind === 'vite') activate(recipe);
if (isNapiWasm(dependency)) retain(dependency);
`,
      ),
    ).toEqual([
      'generic.ts:1: consumer-specific runtime literal "lightningcss-wasm"',
      'generic.ts:1: consumer-specific runtime literal "napi-wasm"',
      'generic.ts:1: consumer-specific runtime literal "sass-embedded"',
      'generic.ts:2: consumer-specific runtime literal "vite"',
      'generic.ts:3: consumer-specific identifier in a generic control-flow condition',
    ]);
  });
});
