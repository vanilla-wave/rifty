export const honestShadowSubstitutionGaps = Object.freeze([
  Object.freeze({
    feature: 'Selected esbuild version has no exact substitution recipe',
    gap: 'shadow-registry.esbuild@<selected-version>',
    notes:
      'Normal public metadata selection runs first; any selected version other than the one exact generated recipe throws. Explicit user overrides remain ordinary installs.',
    tests: Object.freeze([
      'tools/shadow-registry/src/synthetic-package-recipes.contract.test.ts',
      'packages/npm-client/src/installer-synthetic-materialization.contract.test.ts',
    ]),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/npm-client/src/package-materialization.ts',
        needle: 'shadow-registry.${name}@${version}',
      }),
    ]),
  }),
  Object.freeze({
    feature: 'Install requires an asset-readiness owner',
    gap: 'npm.install.shadowAssets',
    notes:
      'A public install whose exact package tree requires shadow assets must receive the storage-owned installer; tree installation alone never claims runtime readiness.',
    tests: Object.freeze(['packages/npm-client/src/installer-shadow-assets.test.ts']),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/npm-client/src/installer.ts',
        needle: 'npm.install.shadowAssets',
      }),
    ]),
  }),
  Object.freeze({
    feature: 'Unknown lockfile materialization marker',
    gap: 'npm-client.lockfile.packageMaterialization',
    notes:
      'Unknown protocol, kind, or external recipe id is rejected before staging; no marker is accepted by a lossy partial decode.',
    tests: Object.freeze([
      'packages/npm-client/src/installer-synthetic-materialization.contract.test.ts',
      'packages/npm-client/src/package-materialization-eddy.contract.test.ts',
    ]),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/npm-client/src/package-materialization.ts',
        needle: 'npm-client.lockfile.packageMaterialization',
      }),
    ]),
  }),
  Object.freeze({
    feature: 'Ambiguous legacy shadow-substitution facts',
    gap: 'npm-client.lockfile.shadowSubstitutionFacts',
    notes:
      'A lockfile that cannot identify one exact top-level shadow trace is rejected instead of inventing provenance.',
    tests: Object.freeze(['packages/npm-client/src/shadow-asset-lockfile-facts.contract.test.ts']),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/npm-client/src/shadow-asset-lockfile-facts.ts',
        needle: 'npm-client.lockfile.shadowSubstitutionFacts',
      }),
    ]),
  }),
  Object.freeze({
    feature: 'Unknown historical substitution recipe',
    gap: 'shadow-registry.substitutionRecipe.<id>',
    notes:
      'Lockfile trace hydration accepts the append-only recipe inventory only; an unknown id never aliases to the current recipe.',
    tests: Object.freeze(['packages/npm-client/src/shadow-asset-lockfile-facts.contract.test.ts']),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/npm-client/src/shadow-asset-lockfile-trace.ts',
        needle: 'shadow-registry.substitutionRecipe.${substitutionId}',
      }),
    ]),
  }),
  Object.freeze({
    feature: 'Missing Vite esbuild runtime assets',
    gap: 'vite.esbuild.shadowAssets',
    notes:
      'Both node-entry and direct Vite adapters share the same loud capability ceiling when the exact runtime asset set was not admitted.',
    tests: Object.freeze([
      'packages/workbench/src/workers/node-entry-vite-runtime.contract.test.ts',
      'packages/workbench/src/workers/vite-esbuild-runtime.fault.test.ts',
      'packages/workbench/src/workers/vite-cli-prep.test.ts',
    ]),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/workbench/src/workers/node-entry-vite-runtime.ts',
        needle: 'vite.esbuild.shadowAssets',
      }),
      Object.freeze({
        source: 'packages/workbench/src/workers/vite-esbuild-runtime.ts',
        needle: 'vite.esbuild.shadowAssets',
      }),
    ]),
  }),
  Object.freeze({
    feature: 'External Workbench runtime-asset adapter',
    gap: 'workbench.runtimeAssets.externalAdapter',
    notes:
      'Workbench v0 owns acquisition through its package source/storage composition; arbitrary host adapter injection is not implemented.',
    tests: Object.freeze(['packages/workbench/src/workbench/open-workbench.contract.test.ts']),
    sites: Object.freeze([
      Object.freeze({
        source: 'packages/workbench/src/workbench/open-workbench.ts',
        needle: 'workbench.runtimeAssets.externalAdapter',
      }),
    ]),
  }),
]);
