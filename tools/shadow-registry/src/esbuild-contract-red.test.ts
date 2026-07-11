import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { withNodeContractWorkspace } from './esbuild-contract-node-workspace.ts';
import {
  ESBUILD_CONTRACT_ROW_IDS,
  ESBUILD_GUEST_POLICY_EXPECTATIONS,
  ESBUILD_GUEST_POLICY_ROW_IDS,
  type EsbuildContractApi,
  type EsbuildContractModules,
  type EsbuildContractTranscript,
  type EsbuildContractWorkspace,
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

async function loadCurrentShimPackage(
  workspace: EsbuildContractWorkspace,
): Promise<EsbuildContractModules> {
  const shim = internalsShims['@esbuild/wasi-preview1'];
  if (!shim) throw new Error('esbuild contract: current shim package is missing');
  const packageRoot = `${workspace.root}/node_modules/esbuild`;
  for (const [path, contents] of Object.entries(shim.files)) {
    await workspace.writeFile(`${packageRoot}/${path}`, contents);
  }
  const cjsConsumer = `${workspace.root}/contract-consumer.cjs`;
  const esmConsumer = `${workspace.root}/contract-consumer.mjs`;
  await workspace.writeFile(cjsConsumer, '');
  await workspace.writeFile(
    esmConsumer,
    `import * as namespace from 'esbuild'; export default namespace;\n`,
  );
  const packageRequire = createRequire(cjsConsumer);
  const cjs = packageRequire('esbuild') as EsbuildContractApi;
  const consumerUrl = `${pathToFileURL(esmConsumer).href}?contract=${encodeURIComponent(workspace.root)}`;
  const consumer = (await import(consumerUrl)) as {
    readonly default: Readonly<Record<string, unknown>>;
  };
  const consumerAgain = (await import(consumerUrl)) as {
    readonly default: Readonly<Record<string, unknown>>;
  };
  return {
    cjs,
    esm: consumer.default,
    esmNamespaceStable: consumer.default === consumerAgain.default,
  };
}

describe('current guest esbuild vs native 0.28.0 Vite contract', () => {
  let actual: EsbuildContractTranscript;
  let actualPolicy: EsbuildGuestPolicyTranscript;

  beforeAll(async () => {
    const native = require('esbuild') as EsbuildContractApi;
    const bridgeGlobal = globalThis as typeof globalThis & {
      __riftyEsbuildTransform?: (
        code: string,
        options?: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };
    bridgeGlobal.__riftyEsbuildTransform = (code, options) => native.transform(code, options);
    try {
      await withNodeContractWorkspace(async (workspace) => {
        const modules = await loadCurrentShimPackage(workspace);
        actual = await probeEsbuildContract(modules, workspace);
        actualPolicy = await probeEsbuildGuestPolicy(modules, workspace);
      });
    } finally {
      bridgeGlobal.__riftyEsbuildTransform = undefined;
    }
  });

  it('executes every frozen row instead of accepting an import/setup crash as RED', () => {
    expect(actual.schema).toBe(3);
    expect(actual.version).toBe('0.28.0');
    expect(Object.keys(actual.rows)).toEqual(ESBUILD_CONTRACT_ROW_IDS);
  });

  for (const rowId of ESBUILD_CONTRACT_ROW_IDS) {
    it(`matches upstream row: ${rowId}`, () => {
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
