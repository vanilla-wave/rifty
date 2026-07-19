import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FsSync } from '@riftydev/vfs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMemoryContractWorkspace } from './esbuild-contract-memory-workspace.ts';
import {
  ESBUILD_CONTRACT_ROW_IDS,
  ESBUILD_GUEST_POLICY_EXPECTATIONS,
  ESBUILD_GUEST_POLICY_ROW_IDS,
  type EsbuildContractApi,
  type EsbuildContractModules,
  type EsbuildContractTranscript,
  type EsbuildGuestPolicyExpectation,
  type EsbuildGuestPolicyTranscript,
  probeEsbuildContract,
  probeEsbuildGuestPolicy,
} from './esbuild-contract-probe.ts';
import fixture from './fixtures/esbuild-0.28.0-contract.json';
import policyFixture from './fixtures/esbuild-0.28.0-guest-policy-prerequisites.json';
import { builtinSyntheticPackageRecipes } from './index.ts';

const expected = fixture as unknown as EsbuildContractTranscript;
const expectedPolicy = policyFixture as unknown as EsbuildGuestPolicyTranscript;
const require = createRequire(import.meta.url);

interface NegativeTextPluginBuild {
  onStart(
    callback: () => {
      readonly errors: readonly Readonly<Record<string, unknown>>[];
    },
  ): void;
}

async function loadCurrentShimPackage(
  runtime: EsbuildContractApi,
): Promise<EsbuildContractModules> {
  const recipe = builtinSyntheticPackageRecipes.find((entry) => entry.publicName === 'esbuild');
  if (!recipe) throw new Error('esbuild contract: current synthetic package recipe is missing');
  const container = mkdtempSync(join(tmpdir(), '.rifty-esbuild-overlay-contract-'));
  try {
    const packageRoot = `${container}/node_modules/esbuild`;
    for (const [path, contents] of Object.entries(recipe.files)) {
      const target = `${packageRoot}/${path}`;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    const cjsConsumer = `${container}/contract-consumer.cjs`;
    const esmConsumer = `${container}/contract-consumer.mjs`;
    writeFileSync(cjsConsumer, '');
    writeFileSync(esmConsumer, `import * as namespace from 'esbuild'; export default namespace;\n`);

    const riftyGlobal = globalThis as typeof globalThis & {
      __rifty?: { esbuild?: EsbuildContractApi };
    };
    const previousRifty = riftyGlobal.__rifty;
    riftyGlobal.__rifty = { ...previousRifty, esbuild: runtime };
    try {
      const packageRequire = createRequire(cjsConsumer);
      const cjs = packageRequire('esbuild') as EsbuildContractApi;
      expect(cjs).toBe(runtime);
      const consumerUrl = `${pathToFileURL(esmConsumer).href}?contract=${encodeURIComponent(container)}`;
      const consumer = (await import(consumerUrl)) as {
        readonly default: Readonly<Record<string, unknown>>;
      };
      const consumerAgain = (await import(consumerUrl)) as {
        readonly default: Readonly<Record<string, unknown>>;
      };
      return {
        cjs,
        esm: consumer.default,
        esmDefaultIsCjsOuter: consumer.default.default === cjs,
        esmNamespaceStable: consumer.default === consumerAgain.default,
      };
    } finally {
      if (previousRifty === undefined) Reflect.deleteProperty(riftyGlobal, '__rifty');
      else riftyGlobal.__rifty = previousRifty;
    }
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
}

interface GeneratedEsbuildRuntimeModule {
  readonly default: EsbuildContractApi;
  startEsbuildRuntime(options: {
    readonly wasm: WebAssembly.Module;
    readonly fs: FsSync;
    readonly cwd: string;
  }): Promise<EsbuildContractApi>;
}

async function startGeneratedRuntime(fs: FsSync, cwd: string): Promise<EsbuildContractApi> {
  const generatedUrl = new URL(
    '../../../packages/workbench/src/workers/generated/esbuild-runtime.js',
    import.meta.url,
  ).href;
  const generated = (await import(generatedUrl)) as unknown as GeneratedEsbuildRuntimeModule;
  const wasmBytes = readFileSync(require.resolve('esbuild-wasm/esbuild.wasm'));
  const wasm = await WebAssembly.compile(wasmBytes);
  const runtime = await generated.startEsbuildRuntime({ wasm, fs, cwd });
  expect(runtime).toBe(generated.default);
  return runtime;
}

describe('current guest esbuild vs native 0.28.0 Vite contract', () => {
  let actual: EsbuildContractTranscript;
  let actualPolicy: EsbuildGuestPolicyTranscript;
  let runtime: EsbuildContractApi;

  beforeAll(async () => {
    const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: globalThis,
    });
    try {
      const { fs, workspace } = createMemoryContractWorkspace();
      runtime = await startGeneratedRuntime(fs, workspace.cwd);
      const modules = await loadCurrentShimPackage(runtime);
      actual = await probeEsbuildContract(modules, workspace);
      actualPolicy = await probeEsbuildGuestPolicy(modules, workspace);
    } finally {
      if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
      else Reflect.deleteProperty(globalThis, 'self');
    }
  }, 120_000);

  it('executes every frozen row instead of accepting an import/setup crash', () => {
    expect(actual.schema).toBe(3);
    expect(actual.version).toBe('0.28.0');
    expect(Object.keys(actual.rows)).toEqual(ESBUILD_CONTRACT_ROW_IDS);
  });

  for (const rowId of ESBUILD_CONTRACT_ROW_IDS) {
    if (rowId === 'module') continue;
    it(`matches upstream row: ${rowId}`, () => {
      expect(actual.rows[rowId]).toEqual(expected.rows[rowId]);
    });
  }

  it('matches the upstream module row outside guest-loader-owned default identity', () => {
    const { esmDefaultIsCjsOuter: _hostDefault, ...hostOwned } = actual.rows.module;
    const { esmDefaultIsCjsOuter: _guestDefault, ...expectedHostOwned } = expected.rows.module;
    expect(hostOwned).toEqual(expectedHostOwned);
  });

  it('does not rewrite errno-looking plugin text, notes, or detail after a service round-trip', async () => {
    const text = 'plugin-owned terminal phrase: Not a directory';
    const noteText = 'plugin-owned note: Not a directory';
    const detail = { owner: 'contract-plugin' };
    let failure: unknown;
    try {
      await runtime.build({
        stdin: { contents: 'export default 1', loader: 'js' },
        write: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'target-errno-negative',
            setup(build: NegativeTextPluginBuild): void {
              build.onStart(() => ({
                errors: [
                  {
                    text,
                    location: null,
                    notes: [{ text: noteText, location: null }],
                    detail,
                  },
                ],
              }));
            },
          },
        ],
      });
    } catch (error) {
      failure = error;
    }
    const errors = (failure as { readonly errors?: readonly unknown[] } | undefined)?.errors;
    expect(errors).toHaveLength(1);
    const message = errors?.[0] as {
      readonly text?: unknown;
      readonly pluginName?: unknown;
      readonly notes?: readonly { readonly text?: unknown }[];
      readonly detail?: unknown;
    };
    expect(message.text).toBe(text);
    expect(message.pluginName).toBe('target-errno-negative');
    expect(message.notes?.[0]?.text).toBe(noteText);
    expect(message.detail).toBe(detail);
  });

  it('executes every guest-policy case instead of accepting an early API crash', () => {
    expect(actualPolicy.schema).toBe(1);
    expect(actualPolicy.version).toBe('0.28.0');
    expect(Object.keys(actualPolicy.rows)).toEqual(ESBUILD_GUEST_POLICY_ROW_IDS);
    for (const rowId of ESBUILD_GUEST_POLICY_ROW_IDS) {
      expect(Object.keys(actualPolicy.rows[rowId])).toEqual(
        Object.keys(ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId]),
      );
    }
  });

  for (const rowId of ESBUILD_GUEST_POLICY_ROW_IDS) {
    const expectations = ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId] as Readonly<
      Record<string, EsbuildGuestPolicyExpectation>
    >;
    for (const caseId of Object.keys(expectations)) {
      const fullCaseId = `${rowId}/${caseId}`;
      it(`preserves native validation then refuses guest-only case: ${fullCaseId}`, () => {
        const expectation = expectations[caseId];
        const actualCase = actualPolicy.rows[rowId][caseId];
        if (!expectation || !actualCase)
          throw new Error(`missing guest-policy case ${rowId}/${caseId}`);
        if (expectation.mode === 'native-prerequisite') {
          expect(actualCase).toEqual(expectedPolicy.rows[rowId][caseId]);
        } else {
          expect(actualCase.outcome).toEqual(expectation.outcome);
          if ('evidence' in expectation) expect(actualCase.evidence).toEqual(expectation.evidence);
        }
      });
    }
  }
});
