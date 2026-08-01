import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { DEFAULT_VITE8_CONFIG_JS } from '../../apps/playground/src/vite-project-policy.ts';
import {
  ESBUILD_CONTRACT_ROW_IDS,
  ESBUILD_GUEST_POLICY_EXPECTATIONS,
  ESBUILD_GUEST_POLICY_ROW_IDS,
  type EsbuildContractTranscript,
  type EsbuildGuestPolicyExpectation,
  type EsbuildGuestPolicyTranscript,
  type ModuleRow,
} from '../../tools/shadow-registry/src/esbuild-contract-probe.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  execLineUntil,
  gotoHarness,
  readOwnerFile,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

interface HostEsbuild {
  readonly version: string;
  transform(
    input: string,
    options: Record<string, unknown>,
  ): Promise<{
    readonly code: string;
    readonly map: string;
  }>;
  build(options: Record<string, unknown>): Promise<{
    readonly outputFiles?: readonly { readonly text: string }[];
  }>;
}

interface FullEnvelope {
  readonly health: {
    readonly token: string;
    readonly mode: 'dev';
    readonly kind: 'full';
    readonly schema: 3;
    readonly version: string;
    readonly parityRowIds: readonly string[];
    readonly policySchema: 1;
    readonly policyRowIds: readonly string[];
  };
  readonly publication: PublicationEvidence;
  readonly parity: EsbuildContractTranscript;
  readonly policy: EsbuildGuestPolicyTranscript;
}

interface ModuleEnvelope {
  readonly health: {
    readonly token: string;
    readonly mode: 'build' | 'preview' | 'optimize';
    readonly kind: 'module';
    readonly schema: 3;
    readonly version: string;
    readonly rowIds: readonly ['module'];
  };
  readonly publication: PublicationEvidence;
  readonly module: ModuleRow;
}

interface PublicationEvidence {
  readonly slotPresentBeforeImport: boolean;
  readonly slotEqualsCjsOuter: boolean;
  readonly legacyBridgeAbsent: boolean;
}

interface InfoEnvelope {
  readonly health: {
    readonly token: string;
    readonly mode: 'info';
    readonly kind: 'info-no-start';
    readonly schema: 3;
    readonly launcherReached: true;
    readonly runtimeNotPublished: boolean;
    readonly legacyBridgeAbsent: boolean;
    readonly rowIds: readonly [];
  };
}

interface DirectEnvelope {
  readonly version: string;
  readonly namespaceVersion: string;
  readonly defaultSame: boolean;
  readonly moduleExportsSame: boolean;
  readonly runtimeSame: boolean;
  readonly namespaceKeys: readonly string[];
  readonly namespaceRelations: Readonly<Record<string, boolean>>;
  readonly code: string;
  readonly map: string;
  readonly transformError: TransformErrorEvidence;
}

interface TransformErrorEvidence {
  readonly name: string;
  readonly message: string;
  readonly errors: readonly unknown[];
  readonly warnings: readonly unknown[];
}

interface ModuleNotFoundEvidence {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly requireStack: readonly string[];
}

interface ContractPaths {
  readonly dir: string;
  readonly devRunner: string;
  readonly buildRunner: string;
  readonly previewRunner: string;
  readonly optimizeRunner: string;
  readonly infoRunner: string;
  readonly devResult: string;
  readonly buildResult: string;
  readonly previewResult: string;
  readonly optimizeResult: string;
  readonly infoResult: string;
}

const VITE_BIN = '/scratch/node_modules/.bin/vite';
const PUBLIC_VITE_BIN = '/node_modules/.bin/vite';
const PROVEN_VITE8_WASI_RUNTIME_OVERRIDE = {
  '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.1.6',
} as const;
const DIRECT_SOURCE = 'export const answer: number = 42;\n';
const DIRECT_TRANSFORM_OPTIONS = Object.freeze({
  loader: 'ts',
  format: 'esm',
  sourcemap: 'external',
  sourcefile: 'direct.ts',
});
const DIRECT_ERROR_SOURCE = 'export const broken: = 1;\n';
const DIRECT_ERROR_OPTIONS = Object.freeze({
  loader: 'ts',
  sourcefile: 'direct-error.ts',
});
const expectedContract = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../tools/shadow-registry/src/fixtures/esbuild-0.28.0-contract.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as EsbuildContractTranscript;
const expectedPolicy = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../tools/shadow-registry/src/fixtures/esbuild-0.28.0-guest-policy-prerequisites.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as EsbuildGuestPolicyTranscript;
const shadowRequire = createRequire(
  new URL('../../tools/shadow-registry/package.json', import.meta.url),
);
const hostEsbuild = shadowRequire('esbuild') as HostEsbuild;

function pathsFor(token: string, fixtureRoot: '/scratch' | ''): ContractPaths {
  const dir = `${fixtureRoot}/.rifty-esbuild-contract-${token}`;
  return {
    dir,
    devRunner: `${dir}/dev-full.cjs`,
    buildRunner: `${dir}/build-module.mjs`,
    previewRunner: `${dir}/preview-module.mjs`,
    optimizeRunner: `${dir}/optimize-module.mjs`,
    infoRunner: `${dir}/info-no-start.cjs`,
    devResult: `${dir}/dev-full.json`,
    buildResult: `${dir}/build-module.json`,
    previewResult: `${dir}/preview-module.json`,
    optimizeResult: `${dir}/optimize-module.json`,
    infoResult: `${dir}/info-no-start.json`,
  };
}

async function installedPackageVersion(page: Page, packageName: string): Promise<string> {
  const manifest = await readOwnerFile(page, `/scratch/node_modules/${packageName}/package.json`);
  expect(manifest.ok, manifest.error).toBe(true);
  if (!manifest.ok) throw new Error(`${packageName} manifest missing`);
  const parsed = JSON.parse(manifest.text) as { readonly version?: unknown };
  if (typeof parsed.version !== 'string') {
    throw new Error(`${packageName} manifest version missing`);
  }
  return parsed.version;
}

async function bundleProbe(): Promise<string> {
  const result = await hostEsbuild.build({
    entryPoints: [
      fileURLToPath(
        new URL('../../tools/shadow-registry/src/esbuild-contract-probe.ts', import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'RiftyEsbuildContractProbe',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error('shared esbuild contract probe bundle missing');
  return source;
}

function workspaceFactory(): string {
  return `
function listContractFiles(target) {
  if (!fs.existsSync(target)) return [];
  if (!fs.statSync(target).isDirectory()) return [target];
  return fs.readdirSync(target).flatMap((entry) =>
    listContractFiles(path.join(target, entry))).sort();
}
function makeContractWorkspace(root) {
  const cwd = globalThis.process.cwd();
  const relativeRoot = RiftyEsbuildContractProbe.explicitContractRelativePath(
    path.relative(cwd, root),
  );
  return {
    root,
    cwd,
    relativeRoot,
    mkdir: async (target) => { fs.mkdirSync(target, { recursive: true }); },
    writeFile: async (target, contents) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    },
    readFile: async (target) => fs.readFileSync(target, 'utf8'),
    exists: (target) => fs.existsSync(target),
    listFiles: listContractFiles,
  };
}
`;
}

function devRunner(bundle: string, token: string, paths: ContractPaths): string {
  const parityRoot = `${paths.dir}/dev-parity-workspace`;
  const policyRoot = `${paths.dir}/dev-policy-workspace`;
  const completion = `RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:dev\n`;
  return `${bundle}
const runtimeRealmBeforeImport = globalThis.__rifty;
const runtimeSlotPresentBeforeImport =
  runtimeRealmBeforeImport !== undefined && Reflect.has(runtimeRealmBeforeImport, 'esbuild');
const runtimeBeforeImport = runtimeRealmBeforeImport?.esbuild;
const legacyBridgeAbsentBeforeImport = !Reflect.has(globalThis, '__riftyEsbuildTransform');
const cjs = require('esbuild');
module.exports.__promise = (async () => {
  const esm = await import('esbuild');
  const esmAgain = await import('esbuild');
  const fs = require('node:fs');
  const path = require('node:path');
  ${workspaceFactory()}
  const modules = {
    cjs,
    esm,
    esmDefaultIsCjsOuter: esm.default === cjs,
    esmNamespaceStable: esmAgain === esm,
  };
  const parity = await RiftyEsbuildContractProbe.probeEsbuildContract(
    modules,
    makeContractWorkspace(${JSON.stringify(parityRoot)}),
  );
  const policy = await RiftyEsbuildContractProbe.probeEsbuildGuestPolicy(
    modules,
    makeContractWorkspace(${JSON.stringify(policyRoot)}),
  );
  fs.writeFileSync(
    ${JSON.stringify(paths.devResult)},
    JSON.stringify({
      health: {
        token: ${JSON.stringify(token)},
        mode: 'dev',
        kind: 'full',
        schema: parity.schema,
        version: parity.version,
        parityRowIds: Object.keys(parity.rows),
        policySchema: policy.schema,
        policyRowIds: Object.keys(policy.rows),
      },
      publication: {
        slotPresentBeforeImport: runtimeSlotPresentBeforeImport,
        slotEqualsCjsOuter: runtimeBeforeImport === cjs,
        legacyBridgeAbsent: legacyBridgeAbsentBeforeImport,
      },
      parity,
      policy,
    }),
  );
  globalThis.process.stdout.write(${JSON.stringify(completion)});
})();
`;
}

function moduleRunner(
  bundle: string,
  token: string,
  mode: 'build' | 'preview' | 'optimize',
  root: string,
  resultPath: string,
): string {
  const completion = `RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:${mode}\n`;
  return `import { createRequire } from 'node:module';
${bundle}
const runtimeRealmBeforeImport = globalThis.__rifty;
const runtimeSlotPresentBeforeImport =
  runtimeRealmBeforeImport !== undefined && Reflect.has(runtimeRealmBeforeImport, 'esbuild');
const runtimeBeforeImport = runtimeRealmBeforeImport?.esbuild;
const legacyBridgeAbsentBeforeImport = !Reflect.has(globalThis, '__riftyEsbuildTransform');
const esm = await import('esbuild');
const require = createRequire(import.meta.url);
const cjs = require('esbuild');
const esmAgain = await import('esbuild');
const fs = require('node:fs');
const path = require('node:path');
${workspaceFactory()}
const moduleRow = await RiftyEsbuildContractProbe.probeEsbuildModuleContract(
  {
    cjs,
    esm,
    esmDefaultIsCjsOuter: esm.default === cjs,
    esmNamespaceStable: esmAgain === esm,
  },
  makeContractWorkspace(${JSON.stringify(root)}),
);
fs.writeFileSync(
  ${JSON.stringify(resultPath)},
  JSON.stringify({
    health: {
      token: ${JSON.stringify(token)},
      mode: ${JSON.stringify(mode)},
      kind: 'module',
      schema: 3,
      version: cjs.version,
      rowIds: ['module'],
    },
    publication: {
      slotPresentBeforeImport: runtimeSlotPresentBeforeImport,
      slotEqualsCjsOuter: runtimeBeforeImport === cjs,
      legacyBridgeAbsent: legacyBridgeAbsentBeforeImport,
    },
    module: moduleRow,
  }),
);
globalThis.process.stdout.write(${JSON.stringify(completion)});
`;
}

function infoRunner(token: string, paths: ContractPaths): string {
  const completion = `RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:info\n`;
  return `const fs = require('node:fs');
const runtimeRealm = globalThis.__rifty;
const runtimeNotPublished =
  runtimeRealm === undefined || !Reflect.has(runtimeRealm, 'esbuild');
const legacyBridgeAbsent = !Reflect.has(globalThis, '__riftyEsbuildTransform');
fs.writeFileSync(
  ${JSON.stringify(paths.infoResult)},
  JSON.stringify({
    health: {
      token: ${JSON.stringify(token)},
      mode: 'info',
      kind: 'info-no-start',
      schema: 3,
      launcherReached: true,
      runtimeNotPublished,
      legacyBridgeAbsent,
      rowIds: [],
    },
  }),
);
globalThis.process.stdout.write(${JSON.stringify(completion)});
`;
}

function directCjsRunner(resultPath: string): string {
  return `const fs = require('node:fs');
const cjs = require('esbuild');
module.exports.__promise = (async () => {
  const esm = await import('esbuild');
  const transformed = await cjs.transform(
    ${JSON.stringify(DIRECT_SOURCE)},
    ${JSON.stringify(DIRECT_TRANSFORM_OPTIONS)},
  );
  let transformError;
  try {
    await cjs.transform(
      ${JSON.stringify(DIRECT_ERROR_SOURCE)},
      ${JSON.stringify(DIRECT_ERROR_OPTIONS)},
    );
  } catch (error) {
    transformError = {
      name: error.name,
      message: error.message,
      errors: error.errors,
      warnings: error.warnings,
    };
  }
  const namespaceKeys = Object.keys(esm).sort();
  const namespaceRelations = Object.fromEntries(
    namespaceKeys
      .filter((key) => key !== 'default' && key !== 'module.exports')
      .map((key) => [key, esm[key] === cjs[key]]),
  );
  fs.writeFileSync(
    ${JSON.stringify(resultPath)},
    JSON.stringify({
      version: cjs.version,
      namespaceVersion: esm.version,
      defaultSame: esm.default === cjs,
      moduleExportsSame: esm['module.exports'] === cjs,
      runtimeSame: globalThis.__rifty?.esbuild === cjs,
      namespaceKeys,
      namespaceRelations,
      code: transformed.code,
      map: transformed.map,
      transformError,
    }),
  );
})();
`;
}

function directEsmRunner(resultPath: string): string {
  return `import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as esm from 'esbuild';
const require = createRequire(import.meta.url);
const cjs = require('esbuild');
const transformed = await esm.transform(
  ${JSON.stringify(DIRECT_SOURCE)},
  ${JSON.stringify(DIRECT_TRANSFORM_OPTIONS)},
);
let transformError;
try {
  await esm.transform(
    ${JSON.stringify(DIRECT_ERROR_SOURCE)},
    ${JSON.stringify(DIRECT_ERROR_OPTIONS)},
  );
} catch (error) {
  transformError = {
    name: error.name,
    message: error.message,
    errors: error.errors,
    warnings: error.warnings,
  };
}
const namespaceKeys = Object.keys(esm).sort();
const namespaceRelations = Object.fromEntries(
  namespaceKeys
    .filter((key) => key !== 'default' && key !== 'module.exports')
    .map((key) => [key, esm[key] === cjs[key]]),
);
fs.writeFileSync(
  ${JSON.stringify(resultPath)},
  JSON.stringify({
    version: cjs.version,
    namespaceVersion: esm.version,
    defaultSame: esm.default === cjs,
    moduleExportsSame: esm['module.exports'] === cjs,
    runtimeSame: globalThis.__rifty?.esbuild === cjs,
    namespaceKeys,
    namespaceRelations,
    code: transformed.code,
    map: transformed.map,
    transformError,
  }),
);
`;
}

function missingEsbuildRunner(resultPath: string): string {
  return `const fs = require('node:fs');
let evidence;
try {
  require('esbuild');
  evidence = { loaded: true };
} catch (error) {
  evidence = {
    name: error.name,
    code: error.code,
    message: error.message,
    requireStack: error.requireStack,
  };
}
fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(evidence));
`;
}

function nativeMissingEsbuildEvidence(): ModuleNotFoundEvidence {
  const missingRequire = createRequire('file:///missing.cjs');
  try {
    missingRequire.resolve('esbuild', { paths: [] });
  } catch (error) {
    const record = error as ModuleNotFoundEvidence;
    return {
      name: record.name,
      code: record.code,
      message: record.message,
      requireStack: record.requireStack,
    };
  }
  throw new Error('native missing-module oracle unexpectedly resolved esbuild from /missing.cjs');
}

function transformErrorEvidence(error: unknown): TransformErrorEvidence {
  const record = error as {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly errors?: unknown;
    readonly warnings?: unknown;
  };
  return JSON.parse(
    JSON.stringify({
      name: record.name,
      message: record.message,
      errors: record.errors,
      warnings: record.warnings,
    }),
  ) as TransformErrorEvidence;
}

async function hostTransformErrorEvidence(): Promise<TransformErrorEvidence> {
  try {
    await hostEsbuild.transform(DIRECT_ERROR_SOURCE, DIRECT_ERROR_OPTIONS);
  } catch (error) {
    return transformErrorEvidence(error);
  }
  throw new Error('native esbuild accepted the direct transform error fixture');
}

function namespaceRelations(
  namespace: Readonly<Record<string, unknown>>,
  cjs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, boolean>> {
  return Object.fromEntries(
    Object.keys(namespace)
      .sort()
      .filter((key) => key !== 'default' && key !== 'module.exports')
      .map((key) => [key, namespace[key] === cjs[key]]),
  );
}

function decodedRequestUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function aliasRequests(urls: readonly string[]): readonly string[] {
  return urls.filter((url) => decodedRequestUrl(url).includes('@esbuild/wasi-preview1'));
}

function registryPackageRequests(urls: readonly string[], packageName: string): readonly string[] {
  return urls.filter((url) => {
    try {
      return (
        new URL(url).pathname.includes('/npm-registry') &&
        decodedRequestUrl(url).includes(packageName)
      );
    } catch {
      return false;
    }
  });
}

function hostEsbuildWasmRequests(urls: readonly string[]): readonly string[] {
  return urls.filter((url) => {
    try {
      return new URL(url).pathname.endsWith('/esbuild.wasm');
    } catch {
      return false;
    }
  });
}

function launcher(target: string): string {
  return `#!/usr/bin/env node\nimport(${JSON.stringify(target)});\n`;
}

function parseResult<T>(
  result: { readonly ok: boolean; readonly text: string; readonly error: string },
  label: string,
): T {
  expect(result.ok, `${label}: ${result.error}`).toBe(true);
  return JSON.parse(result.text) as T;
}

async function runContractHarness(page: Page): Promise<{
  readonly dev: FullEnvelope;
  readonly build: ModuleEnvelope;
  readonly preview: ModuleEnvelope;
  readonly optimize: ModuleEnvelope;
  readonly info: InfoEnvelope;
}> {
  const token = randomUUID();
  const fixturePaths = pathsFor(token, '/scratch');
  const paths = pathsFor(token, '');
  const bundle = await bundleProbe();
  const original = await readOwnerFile(page, VITE_BIN);
  expect(original.ok, original.error).toBe(true);

  await writeOwnerFile(page, fixturePaths.devRunner, devRunner(bundle, token, paths));
  await writeOwnerFile(
    page,
    fixturePaths.buildRunner,
    moduleRunner(bundle, token, 'build', `${paths.dir}/build-workspace`, paths.buildResult),
  );
  await writeOwnerFile(
    page,
    fixturePaths.previewRunner,
    moduleRunner(bundle, token, 'preview', `${paths.dir}/preview-workspace`, paths.previewResult),
  );
  await writeOwnerFile(
    page,
    fixturePaths.optimizeRunner,
    moduleRunner(
      bundle,
      token,
      'optimize',
      `${paths.dir}/optimize-workspace`,
      paths.optimizeResult,
    ),
  );
  await writeOwnerFile(page, fixturePaths.infoRunner, infoRunner(token, paths));

  let dev: Awaited<ReturnType<typeof execLine>>;
  let build: Awaited<ReturnType<typeof execLine>>;
  let preview: Awaited<ReturnType<typeof execLine>>;
  let optimize: Awaited<ReturnType<typeof execLine>>;
  let info: Awaited<ReturnType<typeof execLine>>;
  try {
    await writeOwnerFile(page, VITE_BIN, launcher(paths.devRunner));
    dev = await execLine(page, 'vite');
    await writeOwnerFile(page, VITE_BIN, launcher(paths.buildRunner));
    build = await execLine(page, 'vite build');
    await writeOwnerFile(page, VITE_BIN, launcher(paths.previewRunner));
    preview = await execLine(page, 'vite preview');
    await writeOwnerFile(page, VITE_BIN, launcher(paths.optimizeRunner));
    optimize = await execLine(page, 'vite optimize --force');
    await writeOwnerFile(page, VITE_BIN, launcher(paths.infoRunner));
    info = await execLine(page, 'vite --version');
  } finally {
    await writeOwnerFile(page, VITE_BIN, original.text);
  }

  const devFile = await readOwnerFile(page, fixturePaths.devResult);
  const buildFile = await readOwnerFile(page, fixturePaths.buildResult);
  const previewFile = await readOwnerFile(page, fixturePaths.previewResult);
  const optimizeFile = await readOwnerFile(page, fixturePaths.optimizeResult);
  const infoFile = await readOwnerFile(page, fixturePaths.infoResult);
  const restored = await readOwnerFile(page, VITE_BIN);
  const cleanup = await execLine(page, `rm -rf ${paths.dir}`);

  expect(hostEsbuild.version).toBe('0.28.0');
  for (const [mode, result] of [
    ['dev', dev],
    ['build', build],
    ['preview', preview],
    ['optimize', optimize],
    ['info', info],
  ] as const) {
    expect(result.exit, `${mode}: ${result.out}`).toBe(0);
    expect(result.out).toContain(`RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:${mode}`);
  }
  expect(restored.ok, restored.error).toBe(true);
  expect(restored.text).toBe(original.text);
  expect(cleanup.exit, cleanup.out).toBe(0);

  const devEnvelope = parseResult<FullEnvelope>(devFile, 'dev full');
  const buildEnvelope = parseResult<ModuleEnvelope>(buildFile, 'build module');
  const previewEnvelope = parseResult<ModuleEnvelope>(previewFile, 'preview module');
  const optimizeEnvelope = parseResult<ModuleEnvelope>(optimizeFile, 'optimize module');
  const infoEnvelope = parseResult<InfoEnvelope>(infoFile, 'info no-start');

  expect(devEnvelope.health).toEqual({
    token,
    mode: 'dev',
    kind: 'full',
    schema: 3,
    version: '0.28.0',
    parityRowIds: ESBUILD_CONTRACT_ROW_IDS,
    policySchema: 1,
    policyRowIds: ESBUILD_GUEST_POLICY_ROW_IDS,
  });
  expect(Object.keys(devEnvelope.parity.rows)).toEqual(ESBUILD_CONTRACT_ROW_IDS);
  expect(Object.keys(devEnvelope.publication)).toEqual([
    'slotPresentBeforeImport',
    'slotEqualsCjsOuter',
    'legacyBridgeAbsent',
  ]);
  expect(Object.keys(devEnvelope.policy.rows)).toEqual(ESBUILD_GUEST_POLICY_ROW_IDS);
  for (const rowId of ESBUILD_GUEST_POLICY_ROW_IDS) {
    expect(Object.keys(devEnvelope.policy.rows[rowId])).toEqual(
      Object.keys(ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId]),
    );
  }
  for (const [mode, envelope] of [
    ['build', buildEnvelope],
    ['preview', previewEnvelope],
    ['optimize', optimizeEnvelope],
  ] as const) {
    expect(envelope.health).toEqual({
      token,
      mode,
      kind: 'module',
      schema: 3,
      version: '0.28.0',
      rowIds: ['module'],
    });
    expect(Object.keys(envelope.publication)).toEqual([
      'slotPresentBeforeImport',
      'slotEqualsCjsOuter',
      'legacyBridgeAbsent',
    ]);
    expect(Object.keys(envelope.module)).toEqual(Object.keys(expectedContract.rows.module));
  }
  expect(infoEnvelope.health).toEqual({
    token,
    mode: 'info',
    kind: 'info-no-start',
    schema: 3,
    launcherReached: true,
    runtimeNotPublished: true,
    legacyBridgeAbsent: true,
    rowIds: [],
  });

  return {
    dev: devEnvelope,
    build: buildEnvelope,
    preview: previewEnvelope,
    optimize: optimizeEnvelope,
    info: infoEnvelope,
  };
}

function comparePolicySoft(actual: EsbuildGuestPolicyTranscript): void {
  for (const rowId of ESBUILD_GUEST_POLICY_ROW_IDS) {
    const expectations = ESBUILD_GUEST_POLICY_EXPECTATIONS[rowId] as Readonly<
      Record<string, EsbuildGuestPolicyExpectation>
    >;
    for (const caseId of Object.keys(expectations)) {
      const expectation = expectations[caseId];
      const actualCase = actual.rows[rowId][caseId];
      expect.soft(actualCase, `${rowId}/${caseId} exists`).toBeDefined();
      if (!expectation || !actualCase) continue;
      if (expectation.mode === 'native-prerequisite') {
        expect
          .soft(actualCase, `${rowId}/${caseId} native`)
          .toEqual(expectedPolicy.rows[rowId][caseId]);
      } else {
        expect.soft(actualCase.outcome, `${rowId}/${caseId} gap`).toEqual(expectation.outcome);
        if ('evidence' in expectation) {
          expect
            .soft(actualCase.evidence, `${rowId}/${caseId} evidence`)
            .toEqual(expectation.evidence);
        }
      }
    }
  }
}

async function executeBuiltBrowserModule(page: Page, source: string): Promise<string> {
  return page.evaluate(async (code) => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      await import(url);
      return app.textContent ?? '';
    } finally {
      URL.revokeObjectURL(url);
      app.remove();
    }
  }, source);
}

interface ViteServerRender {
  readonly out: string;
  readonly status: number;
  readonly body: string;
  readonly source: string;
  readonly renderedText?: string;
}

async function runViteServerRenders(
  page: Page,
): Promise<{ readonly dev: ViteServerRender; readonly preview: ViteServerRender }> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const project = fixture.currentProject();
    let devRun: ReturnType<typeof project.run> | null = null;
    let previewRun: ReturnType<ReturnType<typeof project.run>['terminal']['run']> | null = null;
    let detach: (() => void) | null = null;
    try {
      devRun = project.run();
      let devOut = '';
      detach = devRun.terminal.attach((chunk: string) => {
        devOut += chunk;
      });
      const devHandle = await devRun.ready;
      const devPreview = fixture
        .currentSessionTools()
        .previews.snapshot()
        .find((entry: { readonly port: number }) => entry.port === devHandle.port);
      if (devPreview === undefined) {
        throw new Error(`Vite dev ${devHandle.port} is absent from the routed registry`);
      }
      const devResponse = await fetch(new URL(devHandle.url, location.href));
      const devBody = await devResponse.text();
      const devStopped = await devRun.stop();
      const devClosed = await devRun.close();
      const terminal = devRun.terminal;
      devRun = null;
      detach();
      detach = null;
      if (devStopped.code !== devClosed.code || devStopped.signal !== devClosed.signal) {
        throw new Error('Vite dev stop/close changed its exit outcome');
      }

      let previewOut = '';
      let resolveMarker!: () => void;
      const markerSeen = new Promise<void>((resolve) => {
        resolveMarker = resolve;
      });
      detach = terminal.attach((chunk: string) => {
        previewOut += chunk;
        if (previewOut.includes('Local')) resolveMarker();
      });
      previewRun = terminal.run('vite preview --host 127.0.0.1 --port 4174');
      let markerTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          markerSeen,
          previewRun.exited.then((exit: unknown) => {
            throw new Error(
              `Vite preview exited before "Local": ${JSON.stringify(exit)}\n${previewOut}`,
            );
          }),
          new Promise<never>((_resolve, reject) => {
            markerTimer = setTimeout(
              () => reject(new Error(`Vite preview did not print "Local"\n${previewOut}`)),
              30_000,
            );
          }),
        ]);
      } finally {
        if (markerTimer !== null) clearTimeout(markerTimer);
      }

      const previews = fixture.currentSessionTools().previews;
      const deadline = Date.now() + 30_000;
      let preview:
        | { readonly port: number; readonly url: string; readonly source: string }
        | undefined;
      while (preview === undefined) {
        preview = previews
          .snapshot()
          .find((entry: { readonly port: number }) => entry.port === 4174);
        if (preview !== undefined) break;
        if (Date.now() >= deadline) {
          throw new Error(`Vite preview 4174 did not reach the routed registry\n${previewOut}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      const previewResponse = await fetch(new URL(preview.url, location.href));
      const previewBody = await previewResponse.text();
      const previewFrame = document.createElement('iframe');
      previewFrame.src = new URL(preview.url, location.href).href;
      const previewLoaded = new Promise<void>((resolve, reject) => {
        previewFrame.addEventListener('load', () => resolve(), { once: true });
        previewFrame.addEventListener(
          'error',
          () => reject(new Error(`Vite preview iframe failed to load ${previewFrame.src}`)),
          { once: true },
        );
      });
      document.body.appendChild(previewFrame);
      let frameTimer: ReturnType<typeof setTimeout> | null = null;
      let renderedText = '';
      try {
        await Promise.race([
          previewLoaded,
          new Promise<never>((_resolve, reject) => {
            frameTimer = setTimeout(
              () => reject(new Error(`Vite preview iframe timed out at ${previewFrame.src}`)),
              30_000,
            );
          }),
        ]);
        renderedText = previewFrame.contentDocument?.querySelector('#app')?.textContent ?? '';
      } finally {
        if (frameTimer !== null) clearTimeout(frameTimer);
        previewFrame.remove();
      }
      const previewStopped = await previewRun.stop();
      const previewClosed = await previewRun.close();
      previewRun = null;
      if (
        previewStopped.code !== previewClosed.code ||
        previewStopped.signal !== previewClosed.signal
      ) {
        throw new Error('Vite preview stop/close changed its exit outcome');
      }
      return {
        dev: {
          out: devOut,
          status: devResponse.status,
          body: devBody,
          source: devPreview.source,
        },
        preview: {
          out: previewOut,
          status: previewResponse.status,
          body: previewBody,
          source: preview.source,
          renderedText,
        },
      };
    } finally {
      detach?.();
      if (previewRun !== null) {
        await previewRun.stop().catch(() => {});
        await previewRun.close().catch(() => {});
      }
      if (devRun !== null) {
        await devRun.stop().catch(() => {});
        await devRun.close().catch(() => {});
      }
    }
  }, sealedWorkbenchFixtureUrl);
}

test('Vite 7 config graph and dependency optimizer use real esbuild over owner VFS', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await gotoHarness(page);
  const bootOptions = {
    workspaceId: 'bu-esbuild-vite-contract',
    template: 'vite' as const,
    setup: 'instant' as const,
    starter: 'real-vite',
    hiddenEmptyBoot: false,
    persistence: 'preferred' as const,
  };
  let ownerOpen = false;
  await bootOwner(page, bootOptions);
  ownerOpen = true;

  try {
    const which = await execLine(page, 'which vite');
    expect(which).toMatchObject({ exit: 0 });
    expect(which.out).toContain(PUBLIC_VITE_BIN);
    const version = await execLine(page, 'vite --version');
    expect(version).toMatchObject({ exit: 0 });
    expect(version.out).toContain('vite/7.3.6');

    const contract = await runContractHarness(page);
    expect(
      await executeBuiltBrowserModule(
        page,
        `document.getElementById('app').textContent = 'module-execution-harness-ok';`,
      ),
    ).toBe('module-execution-harness-ok');

    const removeTemplateConfig = await execLine(page, 'rm vite.config.js');
    expect(removeTemplateConfig).toMatchObject({ exit: 0 });
    await writeOwnerFile(
      page,
      '/scratch/vite.config.ts',
      `import { marker } from './config-helper.ts';
export default { define: { __RIFTY_CONFIG_MARKER__: JSON.stringify(marker) } };
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/config-helper.ts',
      `export const marker = 'config-helper-marker';
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/src/main.js',
      `import pc from 'picocolors';
document.getElementById('app').textContent = __RIFTY_CONFIG_MARKER__ + ':' + pc.green('dep-marker');
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/.rifty-prebundle-consumer.mjs',
      `import pc from './node_modules/.vite/deps/picocolors.js';
globalThis.process.stdout.write(pc.green('usable-prebundle-marker'));
`,
    );

    // The real guest loader/CLI Worker/VFS owns the full module identity row;
    // the Node harness covers every field except its host-only ESM namespace.
    for (const rowId of ESBUILD_CONTRACT_ROW_IDS) {
      expect
        .soft(contract.dev.parity.rows[rowId], `guest parity ${rowId}`)
        .toEqual(expectedContract.rows[rowId]);
    }
    comparePolicySoft(contract.dev.policy);
    for (const [mode, publication] of [
      ['dev', contract.dev.publication],
      ['build', contract.build.publication],
      ['preview', contract.preview.publication],
      ['optimize', contract.optimize.publication],
    ] as const) {
      expect.soft(publication, `${mode} runtime published before first import`).toEqual({
        slotPresentBeforeImport: true,
        slotEqualsCjsOuter: true,
        legacyBridgeAbsent: true,
      });
    }
    for (const [mode, envelope] of [
      ['build', contract.build],
      ['preview', contract.preview],
      ['optimize', contract.optimize],
    ] as const) {
      expect
        .soft(envelope.module, `${mode} import-first module`)
        .toEqual(expectedContract.rows.module);
    }

    const optimize = await execLine(page, 'vite optimize --force');
    const prebundle = await readOwnerFile(page, '/scratch/node_modules/.vite/deps/picocolors.js');
    const prebundleMap = await readOwnerFile(
      page,
      '/scratch/node_modules/.vite/deps/picocolors.js.map',
    );
    const prebundleUse = await execLine(page, 'node .rifty-prebundle-consumer.mjs');
    const build = await execLine(page, 'vite build');
    const distMarker = await execLine(page, 'grep -R config-helper-marker dist');
    const distIndex = await readOwnerFile(page, '/scratch/dist/index.html');
    const distJsName = /src=["'][^"']*\/assets\/([^"']+\.js)["']/.exec(distIndex.text)?.[1];
    const distJs = distJsName
      ? await readOwnerFile(page, `/scratch/dist/assets/${distJsName}`)
      : { ok: false, text: '', error: 'no built JavaScript asset' };
    let prebundleMapParseable = false;
    try {
      const parsed = JSON.parse(prebundleMap.text) as unknown;
      prebundleMapParseable =
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { readonly sources?: unknown }).sources);
    } catch {
      prebundleMapParseable = false;
    }
    let executedDist = '';
    let distExecutionError = '';
    try {
      if (!distJs.ok) throw new Error(distJs.error);
      executedDist = await executeBuiltBrowserModule(page, distJs.text);
    } catch (error) {
      distExecutionError = error instanceof Error ? error.message : String(error);
    }

    expect(
      {
        optimizeExit: optimize.exit,
        prebundleExists: prebundle.ok,
        prebundleMapParseable,
        prebundleUseExit: prebundleUse.exit,
        prebundleUseMarker: prebundleUse.out.includes('usable-prebundle-marker'),
        buildExit: build.exit,
        distMarkerExit: distMarker.exit,
        distContainsMarker: distMarker.out.includes('config-helper-marker'),
        distIndexExists: distIndex.ok,
        distJsExists: distJs.ok,
        executedDist,
        distExecutionError,
      },
      `optimize:\n${optimize.out}\nprebundle:\n${prebundleUse.out}\nbuild:\n${build.out}\ndist grep:\n${distMarker.out}\ndist exec:\n${distExecutionError}`,
    ).toEqual({
      optimizeExit: 0,
      prebundleExists: true,
      prebundleMapParseable: true,
      prebundleUseExit: 0,
      prebundleUseMarker: true,
      buildExit: 0,
      distMarkerExit: 0,
      distContainsMarker: true,
      distIndexExists: true,
      distJsExists: true,
      executedDist: 'config-helper-marker:dep-marker',
      distExecutionError: '',
    });
    expect(aliasRequests(requests), 'retired @esbuild/wasi-preview1 alias request').toEqual([]);
    expect(hostEsbuildWasmRequests(requests), 'retired host esbuild.wasm asset request').toEqual(
      [],
    );
    expect(
      registryPackageRequests(requests, 'esbuild-wasm').length > 0,
      'Vite 7 must acquire the registry recipe asset, not host bytes',
    ).toBe(true);

    await closeOwner(page);
    ownerOpen = false;
    const blockedRegistryRequests: string[] = [];
    await context.route(/\/npm-registry(?:\/|$)/u, async (route) => {
      blockedRegistryRequests.push(route.request().url());
      await route.abort();
    });
    await bootOwner(page, bootOptions);
    ownerOpen = true;
    const offlineBuild = await execLine(page, 'vite build');
    expect(offlineBuild.exit, offlineBuild.out).toBe(0);
    const offlineDev = await execLineUntil(page, 'vite --host 127.0.0.1 --port 5174', 'Local');
    expect(offlineDev.out).toContain('Local');
    expect(
      blockedRegistryRequests,
      'cold-filled Vite tree and registry asset must reopen without acquisition',
    ).toEqual([]);
  } finally {
    if (ownerOpen) await closeOwner(page);
  }
});

test('direct CJS require and ESM import share exact esbuild 0.28.0 without Vite', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await gotoHarness(page);
  const cjsResultPath = '/direct-cjs-result.json';
  const esmResultPath = '/direct-esm-result.json';
  const bootOptions = {
    workspaceId: 'bu-esbuild-direct-contract',
    persistence: 'preferred' as const,
    plan: {
      kind: 'node-cli' as const,
      id: 'scratch',
      starterId: 'direct-esbuild',
      templateId: 'browser-unit:direct-esbuild',
      files: {
        '/package.json': '{"name":"direct-esbuild","private":true,"type":"module"}\n',
        '/direct.cjs': directCjsRunner(cjsResultPath),
        '/direct.mjs': directEsmRunner(esmResultPath),
      },
      dependencies: { esbuild: '0.28.0' },
      firstMaterialization: { kind: 'install' },
      entryPath: '/direct.mjs',
    },
  };
  let ownerOpen = false;
  await bootOwner(page, bootOptions);
  ownerOpen = true;

  try {
    const install = await execLine(page, 'npm install');
    const vite = await execLine(page, 'which vite');
    const config = await readOwnerFile(page, '/scratch/vite.config.js');
    const cjsRun = await execLine(page, 'node direct.cjs');
    const esmRun = await execLine(page, 'node direct.mjs');
    const cli = await execLine(page, 'esbuild --version');
    const cjsFile = await readOwnerFile(page, `/scratch${cjsResultPath}`);
    const esmFile = await readOwnerFile(page, `/scratch${esmResultPath}`);
    const native = await hostEsbuild.transform(DIRECT_SOURCE, DIRECT_TRANSFORM_OPTIONS);
    const nativeNamespace = (await import(
      pathToFileURL(shadowRequire.resolve('esbuild')).href
    )) as Readonly<Record<string, unknown>>;
    const nativeCjs = hostEsbuild as unknown as Readonly<Record<string, unknown>>;

    expect(install.exit, install.out).toBe(0);
    expect(vite.exit, vite.out).toBe(1);
    expect(config.ok).toBe(false);
    expect(cjsRun.exit, cjsRun.out).toBe(0);
    expect(esmRun.exit, esmRun.out).toBe(0);
    expect(cli.exit, cli.out).toBe(1);
    expect(cli.out).toContain('esbuild.cli');

    const expected: DirectEnvelope = {
      version: '0.28.0',
      namespaceVersion: '0.28.0',
      defaultSame: true,
      moduleExportsSame: true,
      runtimeSame: true,
      namespaceKeys: Object.keys(nativeNamespace).sort(),
      namespaceRelations: namespaceRelations(nativeNamespace, nativeCjs),
      code: native.code,
      map: native.map,
      transformError: await hostTransformErrorEvidence(),
    };
    expect(parseResult<DirectEnvelope>(cjsFile, 'direct CJS')).toEqual(expected);
    expect(parseResult<DirectEnvelope>(esmFile, 'direct ESM')).toEqual(expected);
    expect(aliasRequests(requests), 'retired @esbuild/wasi-preview1 alias request').toEqual([]);
    expect(hostEsbuildWasmRequests(requests), 'retired host esbuild.wasm asset request').toEqual(
      [],
    );
    expect(
      registryPackageRequests(requests, 'esbuild-wasm').length > 0,
      'direct esbuild must acquire the registry recipe asset',
    ).toBe(true);

    await closeOwner(page);
    ownerOpen = false;
    const blockedRegistryRequests: string[] = [];
    await context.route(/\/npm-registry(?:\/|$)/u, async (route) => {
      blockedRegistryRequests.push(route.request().url());
      await route.abort();
    });
    await bootOwner(page, bootOptions);
    ownerOpen = true;
    const offlineCjs = await execLine(page, 'node direct.cjs');
    const offlineEsm = await execLine(page, 'node direct.mjs');
    expect(offlineCjs.exit, offlineCjs.out).toBe(0);
    expect(offlineEsm.exit, offlineEsm.out).toBe(0);
    expect(blockedRegistryRequests, 'verified asset/tree must reopen without acquisition').toEqual(
      [],
    );
  } finally {
    if (ownerOpen) await closeOwner(page);
  }
});

test('missing esbuild keeps Node MODULE_NOT_FOUND and unsupported install leaves the tree unchanged', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await gotoHarness(page);
  const resultPath = '/missing-esbuild-result.json';
  await bootOwner(page, {
    workspaceId: 'bu-esbuild-missing-and-unsupported',
    persistence: 'ephemeral',
    plan: {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'missing-esbuild',
      templateId: 'browser-unit:missing-esbuild',
      files: {
        '/package.json': '{"name":"missing-esbuild","private":true,"type":"commonjs"}\n',
        '/missing.cjs': missingEsbuildRunner(resultPath),
      },
      firstMaterialization: { kind: 'install' },
      entryPath: '/missing.cjs',
    },
  });

  try {
    const firstMissing = await execLine(page, 'node missing.cjs');
    const firstEvidence = await readOwnerFile(page, `/scratch${resultPath}`);
    const packageJsonBefore = await readOwnerFile(page, '/scratch/package.json');
    const lockfileBefore = await readOwnerFile(page, '/scratch/package-lock.json');
    const modulesBefore = await execLine(page, 'ls node_modules');

    expect(firstMissing.exit, firstMissing.out).toBe(0);
    expect(parseResult<ModuleNotFoundEvidence>(firstEvidence, 'missing esbuild')).toEqual(
      nativeMissingEsbuildEvidence(),
    );

    const unsupported = await execLine(page, 'npm install esbuild@^0.27');
    const packageJsonAfter = await readOwnerFile(page, '/scratch/package.json');
    const lockfileAfter = await readOwnerFile(page, '/scratch/package-lock.json');
    const modulesAfter = await execLine(page, 'ls node_modules');
    const installed = await readOwnerFile(page, '/scratch/node_modules/esbuild/package.json');
    const secondMissing = await execLine(page, 'node missing.cjs');
    const secondEvidence = await readOwnerFile(page, `/scratch${resultPath}`);

    expect(unsupported.exit, unsupported.out).toBe(1);
    expect(unsupported.out).toContain('esbuild.version');
    expect(packageJsonAfter).toEqual(packageJsonBefore);
    expect(lockfileAfter).toEqual(lockfileBefore);
    expect(modulesAfter).toEqual(modulesBefore);
    expect(installed.ok).toBe(false);
    expect(secondMissing.exit, secondMissing.out).toBe(0);
    expect(
      parseResult<ModuleNotFoundEvidence>(secondEvidence, 'missing after rejected install'),
    ).toEqual(nativeMissingEsbuildEvidence());
    expect(
      registryPackageRequests(requests, 'esbuild-wasm').length > 0,
      'unsupported recipe must not acquire runtime assets',
    ).toBe(false);
  } finally {
    await closeOwner(page);
  }
});

test('real Rifty install honors the npm-standard Vite 8 WASI runtime alias', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-vite8-runtime-alias-oracle',
    persistence: 'ephemeral',
    plan: {
      kind: 'vite',
      id: 'scratch',
      starterId: 'vite8-runtime-alias-oracle',
      templateId: 'browser-unit:vite8-runtime-alias-oracle',
      files: {
        '/package.json': JSON.stringify({
          private: true,
          type: 'module',
          overrides: PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
        }),
        '/index.html': '<div id="app"></div>',
        '/vite.config.js': DEFAULT_VITE8_CONFIG_JS,
      },
      viteVersion: '8.0.16',
      firstMaterialization: { kind: 'install' },
      port: 5174,
    },
  });

  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await expect.poll(() => installedPackageVersion(page, '@napi-rs/wasm-runtime')).toBe('1.1.6');
    expect(await installedPackageVersion(page, '@rolldown/binding-wasm32-wasi')).toBe('1.0.3');
    expect(await installedPackageVersion(page, '@emnapi/core')).toBe('1.10.0');
    expect(await installedPackageVersion(page, '@emnapi/runtime')).toBe('1.10.0');

    await writeOwnerFile(
      page,
      '/scratch/rolldown-wasi-oracle.mjs',
      "await import('rolldown');\nconsole.log('rolldown-wasi-ok');\n",
    );
    const imported = await execLine(page, 'NAPI_RS_FORCE_WASI=1 node rolldown-wasi-oracle.mjs');
    expect(imported.exit, imported.out).toBe(0);
    expect(imported.out).toContain('rolldown-wasi-ok');
  } finally {
    await closeOwner(page);
  }
});

test('Vite 8.0.16 build/preview stay green with no esbuild fetch or activation', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-vite8-empty-esbuild-plan',
    persistence: 'ephemeral',
    plan: {
      kind: 'vite',
      id: 'scratch',
      starterId: 'vite8-empty-esbuild-plan',
      templateId: 'browser-unit:vite8-empty-esbuild-plan',
      files: {
        '/index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
        '/src/main.js': "document.getElementById('app').textContent = 'vite8';\n",
        '/vite.config.js': DEFAULT_VITE8_CONFIG_JS,
      },
      viteVersion: '8.0.16',
      firstMaterialization: { kind: 'install' },
      port: 5174,
    },
  });

  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    expect(await installedPackageVersion(page, '@napi-rs/wasm-runtime')).toBe('1.1.6');
    expect(await installedPackageVersion(page, '@rolldown/binding-wasm32-wasi')).toBe('1.0.3');
    expect(await installedPackageVersion(page, '@emnapi/core')).toBe('1.10.0');
    expect(await installedPackageVersion(page, '@emnapi/runtime')).toBe('1.10.0');

    const version = await execLine(page, 'vite --version');
    expect(version.exit, version.out).toBe(0);
    expect(version.out).toContain('vite/8.0.16');

    const build = await execLine(page, 'vite build');
    expect(build.exit, build.out).toBe(0);
    const distIndex = await readOwnerFile(page, '/scratch/dist/index.html');
    expect(distIndex.ok, distIndex.error).toBe(true);
    expect(distIndex.text).toContain('<div id="app"></div>');
    expect(distIndex.text).not.toContain('/src/main.js');
    const distJsName = /src=["'][^"']*\/assets\/([^"']+\.js)["']/.exec(distIndex.text)?.[1];
    expect(distJsName, distIndex.text).toBeDefined();
    if (!distJsName) throw new Error('Vite 8 build emitted no hashed JavaScript asset');
    const distJs = await readOwnerFile(page, `/scratch/dist/assets/${distJsName}`);
    expect(distJs.ok, distJs.error).toBe(true);
    expect(await executeBuiltBrowserModule(page, distJs.text)).toBe('vite8');

    const servers = await runViteServerRenders(page);
    expect(servers.dev.out).toContain('Local');
    expect(servers.dev.status).toBe(200);
    expect(servers.dev.body).toContain('<div id="app"></div>');
    expect(servers.dev.source).toBe('node');
    expect(servers.preview.out).toContain('Local');
    expect(servers.preview.status).toBe(200);
    expect(servers.preview.body).toContain('<div id="app"></div>');
    expect(servers.preview.body).toContain(`/assets/${distJsName}`);
    expect(servers.preview.source).toBe('preview');
    expect(servers.preview.renderedText).toBe('vite8');

    const original = await readOwnerFile(page, VITE_BIN);
    expect(original.ok, original.error).toBe(true);
    await writeOwnerFile(
      page,
      '/scratch/.vite8-no-esbuild.cjs',
      `const fs = require('node:fs');
const runtime = globalThis.__rifty;
fs.writeFileSync('/vite8-no-esbuild.json', JSON.stringify({
  runtimePresent: runtime !== undefined && Reflect.has(runtime, 'esbuild'),
  legacyBridgePresent: Reflect.has(globalThis, '__riftyEsbuildTransform'),
}));
globalThis.process.stdout.write('RIFTY_VITE8_NO_ESBUILD\\n');
`,
    );
    try {
      await writeOwnerFile(page, VITE_BIN, launcher('/.vite8-no-esbuild.cjs'));
      const probe = await execLine(page, 'vite build');
      expect(probe.exit, probe.out).toBe(0);
      expect(probe.out).toContain('RIFTY_VITE8_NO_ESBUILD');
    } finally {
      await writeOwnerFile(page, VITE_BIN, original.text);
    }

    const probeFile = await readOwnerFile(page, '/scratch/vite8-no-esbuild.json');
    expect(
      parseResult<{ runtimePresent: boolean; legacyBridgePresent: boolean }>(
        probeFile,
        'Vite 8 empty adapter plan',
      ),
    ).toEqual({
      runtimePresent: false,
      legacyBridgePresent: false,
    });
    expect((await readOwnerFile(page, '/scratch/node_modules/esbuild/package.json')).ok).toBe(
      false,
    );
    expect(
      registryPackageRequests(requests, 'esbuild'),
      'Vite 8 cold install must not fetch any esbuild package or asset',
    ).toEqual([]);
    expect(aliasRequests(requests)).toEqual([]);
    expect(hostEsbuildWasmRequests(requests)).toEqual([]);
  } finally {
    await closeOwner(page);
  }
});
