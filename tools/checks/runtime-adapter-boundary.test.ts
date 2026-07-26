import { describe, expect, it } from 'vitest';
import {
  GENERIC_RUNTIME_ADAPTER_MODULES,
  PACKAGE_BIN_AUTHORITY_MODULE,
  PACKAGE_BIN_CONSUMER_MODULES,
  evaluatePackageBinAuthority,
  listNpmClientProductionTypeScriptSources,
  packageBinAuthorityViolations,
  runtimeAdapterBoundaryViolations,
} from './runtime-adapter-boundary.mjs';

describe('runtime adapter generic-module boundary', () => {
  it('lists the finite generic plan/admission/launch surface', () => {
    expect(GENERIC_RUNTIME_ADAPTER_MODULES).toEqual([
      'packages/npm-client/src/installer.ts',
      'packages/npm-client/src/linker.ts',
      'packages/npm-client/src/package-bin.ts',
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
    ]);
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

  it('keeps one package-bin launcher owner across ordinary and shadow materialization', () => {
    expect(PACKAGE_BIN_AUTHORITY_MODULE).toBe('packages/npm-client/src/package-bin.ts');
    expect(PACKAGE_BIN_CONSUMER_MODULES).toEqual([
      'packages/npm-client/src/linker.ts',
      'packages/npm-client/src/internal/shadow/planner.ts',
    ]);
    expect(evaluatePackageBinAuthority()).toEqual([]);
  });

  it('inventories npm-client production TypeScript beyond the required package-bin surface', () => {
    const inventory = listNpmClientProductionTypeScriptSources();
    expect(inventory).toContain('packages/npm-client/src/bounded-fetch.ts');
    expect(inventory).toContain('packages/npm-client/src/internal/shadow/source.ts');
    expect(inventory).not.toContain('packages/npm-client/src/installer.test.ts');
    expect(inventory).not.toContain('packages/npm-client/src/_test-fixtures/tar-builder.ts');
    expect(inventory).not.toContain(
      'packages/npm-client/src/internal/shadow/strict-codec.contract-fixtures.ts',
    );
  });

  it('rejects a missing consumer and a duplicate package-bin owner', () => {
    const owner =
      "export function linkPackageBins() {\n  const shim = `#!/usr/bin/env node\\nimport('../${pkg.name}/${target}');\\n`;\n}\n";
    const consumer = "import { linkPackageBins } from './package-bin.ts';\nlinkPackageBins();\n";
    const sources = new Map<string, string>([
      [PACKAGE_BIN_AUTHORITY_MODULE, owner],
      [PACKAGE_BIN_CONSUMER_MODULES[0]!, consumer],
      [PACKAGE_BIN_CONSUMER_MODULES[1]!, consumer],
      ['packages/npm-client/src/installer.ts', 'export const installer = true;\n'],
    ]);

    const missing = new Map(sources);
    missing.delete(PACKAGE_BIN_CONSUMER_MODULES[1]!);
    expect(packageBinAuthorityViolations(missing)).toEqual([
      `${PACKAGE_BIN_CONSUMER_MODULES[1]}: missing package-bin authority surface`,
    ]);

    const duplicate = new Map(sources);
    duplicate.set('packages/npm-client/src/installer.ts', owner);
    expect(packageBinAuthorityViolations(duplicate)).toEqual([
      'packages/npm-client/src/installer.ts: duplicates package-bin implementation',
    ]);
  });

  it('rejects a duplicate launcher in handwritten and generated production TypeScript', () => {
    const owner =
      "export function linkPackageBins() {\n  const shim = `#!/usr/bin/env node\\nimport('../${pkg.name}/${target}');\\n`;\n}\n";
    const consumer = "import { linkPackageBins } from './package-bin.ts';\nlinkPackageBins();\n";
    const duplicateFile = 'packages/npm-client/src/internal/late-package-launcher.ts';
    const generatedDirectoryFile = 'packages/npm-client/src/generated/late-package-launcher.ts';
    const generatedSuffixFile =
      'packages/npm-client/src/internal/late-package-launcher.generated.ts';
    const unexpectedCallerFile = 'packages/npm-client/src/internal/late-package-bin-caller.ts';
    const duplicateLauncher =
      "export const launcher = `#!/usr/bin/env node\\nimport('../${pkg.name}/${target}');\\n`;\n";
    const sources = new Map<string, string>([
      [PACKAGE_BIN_AUTHORITY_MODULE, owner],
      [PACKAGE_BIN_CONSUMER_MODULES[0]!, consumer],
      [PACKAGE_BIN_CONSUMER_MODULES[1]!, consumer],
      ['packages/npm-client/src/installer.ts', 'export const installer = true;\n'],
      [duplicateFile, duplicateLauncher],
      [generatedDirectoryFile, duplicateLauncher],
      [generatedSuffixFile, duplicateLauncher],
      [unexpectedCallerFile, consumer],
      ['packages/npm-client/src/internal/late-package-launcher.test.ts', duplicateLauncher],
    ]);

    expect(packageBinAuthorityViolations(sources)).toEqual([
      `${duplicateFile}: duplicates package-bin implementation`,
      `${generatedDirectoryFile}: duplicates package-bin implementation`,
      `${generatedSuffixFile}: duplicates package-bin implementation`,
      `${unexpectedCallerFile}: unexpected package-bin owner caller`,
    ]);
  });

  it('rejects renamed concatenated bin writers and aliased unexpected callers', () => {
    const owner =
      "export function linkPackageBins() {\n  const shim = `#!/usr/bin/env node\\nimport('../${pkg.name}/${target}');\\n`;\n}\n";
    const consumer = "import { linkPackageBins } from './package-bin.ts';\nlinkPackageBins();\n";
    const renamedWriterFile = 'packages/npm-client/src/internal/late-command-writer.ts';
    const aliasedCallerFile = 'packages/npm-client/src/internal/late-aliased-caller.ts';
    const sources = new Map<string, string>([
      [PACKAGE_BIN_AUTHORITY_MODULE, owner],
      [PACKAGE_BIN_CONSUMER_MODULES[0]!, consumer],
      [PACKAGE_BIN_CONSUMER_MODULES[1]!, consumer],
      [
        renamedWriterFile,
        `export async function emitCommands(vfs, root, command) {
  const directory = root + '/node_modules/' + ('.' + 'bin');
  const launcher = '#' + '!/usr/bin/env node\\n' + "import('../pkg/cli.js');\\n";
  await vfs['write' + 'File'](directory + '/' + command, launcher);
}
`,
      ],
      [
        aliasedCallerFile,
        "import { linkPackageBins as emitCommands } from '../package-bin.ts';\nemitCommands();\n",
      ],
    ]);

    expect(packageBinAuthorityViolations(sources)).toEqual([
      `${renamedWriterFile}: duplicates package-bin implementation`,
      `${aliasedCallerFile}: unexpected package-bin owner caller`,
    ]);
  });
});
