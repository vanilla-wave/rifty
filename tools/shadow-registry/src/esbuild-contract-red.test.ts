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
  type EsbuildContractRowId,
  type EsbuildContractTranscript,
  type EsbuildGuestPolicyExpectation,
  type EsbuildGuestPolicyTranscript,
  probeEsbuildContract,
  probeEsbuildGuestPolicy,
} from './esbuild-contract-probe.ts';
import fixture from './fixtures/esbuild-0.28.0-contract.json';
import policyFixture from './fixtures/esbuild-0.28.0-guest-policy-prerequisites.json';
import { internalsShims } from './index.ts';

const expected = fixture as unknown as EsbuildContractTranscript;
const expectedPolicy = policyFixture as unknown as EsbuildGuestPolicyTranscript;
const require = createRequire(import.meta.url);
const CURRENTLY_RED_CONTRACT_ROWS = new Set<EsbuildContractRowId>([
  'module',
  'plugin-validation',
  'dep-prebundle-write-failure',
]);
const CURRENTLY_RED_GUEST_POLICY_CASES = new Set([
  'gap-build-effective-write/invalid-plugin-default-write',
  'gap-build-effective-write/invalid-write-type',
  'gap-build-effective-write/false-to-invalid',
  'gap-build-effective-write/omitted-to-invalid',
]);

async function loadCurrentShimPackage(
  runtime: EsbuildContractApi,
): Promise<EsbuildContractModules> {
  const shim = internalsShims['@esbuild/wasi-preview1'];
  if (!shim) throw new Error('esbuild contract: current shim package is missing');
  const container = mkdtempSync(join(tmpdir(), '.rifty-esbuild-overlay-contract-'));
  try {
    const packageRoot = `${container}/node_modules/esbuild`;
    for (const [path, contents] of Object.entries(shim.files)) {
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
    '../../../apps/playground/src/workers/generated/esbuild-runtime.js',
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

  beforeAll(async () => {
    const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: globalThis,
    });
    try {
      const { fs, workspace } = createMemoryContractWorkspace();
      const runtime = await startGeneratedRuntime(fs, workspace.cwd);
      const modules = await loadCurrentShimPackage(runtime);
      actual = await probeEsbuildContract(modules, workspace);
      actualPolicy = await probeEsbuildGuestPolicy(modules, workspace);
    } finally {
      if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
      else Reflect.deleteProperty(globalThis, 'self');
    }
  }, 120_000);

  it('executes every frozen row instead of accepting an import/setup crash as RED', () => {
    expect(actual.schema).toBe(3);
    expect(actual.version).toBe('0.28.0');
    expect(Object.keys(actual.rows)).toEqual(ESBUILD_CONTRACT_ROW_IDS);
  });

  for (const rowId of ESBUILD_CONTRACT_ROW_IDS) {
    const rowTest = CURRENTLY_RED_CONTRACT_ROWS.has(rowId) ? it.fails : it;
    rowTest(`matches upstream row: ${rowId}`, () => {
      expect(actual.rows[rowId]).toEqual(expected.rows[rowId]);
    });
  }

  it('executes every guest-policy case instead of accepting an early API crash as RED', () => {
    expect(actualPolicy.schema).toBe(1);
    expect(actualPolicy.version).toBe('0.28.0');
    expect(Object.keys(actualPolicy.rows)).toEqual(ESBUILD_GUEST_POLICY_ROW_IDS);
    for (const rowId of ESBUILD_GUEST_POLICY_ROW_IDS) {
      expect(Object.keys(actualPolicy.rows[rowId])).toEqual(
        Object.keys(ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId]),
      );
    }
    const allCaseIds = new Set(
      ESBUILD_GUEST_POLICY_ROW_IDS.flatMap((rowId) =>
        Object.keys(ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId]).map((caseId) => `${rowId}/${caseId}`),
      ),
    );
    expect([...CURRENTLY_RED_GUEST_POLICY_CASES].filter((id) => !allCaseIds.has(id))).toEqual([]);
  });

  for (const rowId of ESBUILD_GUEST_POLICY_ROW_IDS) {
    const expectations = ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId] as Readonly<
      Record<string, EsbuildGuestPolicyExpectation>
    >;
    for (const caseId of Object.keys(expectations)) {
      const fullCaseId = `${rowId}/${caseId}`;
      const caseTest = CURRENTLY_RED_GUEST_POLICY_CASES.has(fullCaseId) ? it.fails : it;
      caseTest(`preserves native validation then refuses guest-only case: ${fullCaseId}`, () => {
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
