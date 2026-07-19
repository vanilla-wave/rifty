import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
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
  writeOwnerFile,
} from './fixtures.ts';

interface HostEsbuild {
  readonly version: string;
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

interface ContractPaths {
  readonly dir: string;
  readonly devRunner: string;
  readonly buildRunner: string;
  readonly previewRunner: string;
  readonly optimizeRunner: string;
  readonly devConfig: string;
  readonly buildConfig: string;
  readonly previewConfig: string;
  readonly optimizeConfig: string;
  readonly devResult: string;
  readonly buildResult: string;
  readonly previewResult: string;
  readonly optimizeResult: string;
}

const LOGICAL_VITE_BIN = '/node_modules/.bin/vite';
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
const FIXTURE_ROOT = '/scratch';

function guestPath(path: string): string {
  if (path === FIXTURE_ROOT) return '/';
  if (!path.startsWith(`${FIXTURE_ROOT}/`)) {
    throw new TypeError(`Contract path is outside the sealed fixture root: ${path}`);
  }
  return path.slice(FIXTURE_ROOT.length);
}

function pathsFor(token: string): ContractPaths {
  const dir = `${FIXTURE_ROOT}/.rifty-esbuild-contract-${token}`;
  return {
    dir,
    devRunner: `${dir}/dev-full.cjs`,
    buildRunner: `${dir}/build-module.mjs`,
    previewRunner: `${dir}/preview-module.mjs`,
    optimizeRunner: `${dir}/optimize-module.mjs`,
    devConfig: `${dir}/dev.config.mjs`,
    buildConfig: `${dir}/build.config.mjs`,
    previewConfig: `${dir}/preview.config.mjs`,
    optimizeConfig: `${dir}/optimize.config.mjs`,
    devResult: `${dir}/dev-full.json`,
    buildResult: `${dir}/build-module.json`,
    previewResult: `${dir}/preview-module.json`,
    optimizeResult: `${dir}/optimize-module.json`,
  };
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
  const parityRoot = `${guestPath(paths.dir)}/dev-parity-workspace`;
  const policyRoot = `${guestPath(paths.dir)}/dev-policy-workspace`;
  const completion = `RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:dev\n`;
  return `import { createRequire } from 'node:module';
${bundle}
const runtimeRealmBeforeImport = globalThis.__rifty;
const runtimeSlotPresentBeforeImport =
  runtimeRealmBeforeImport !== undefined && Reflect.has(runtimeRealmBeforeImport, 'esbuild');
const runtimeBeforeImport = runtimeRealmBeforeImport?.esbuild;
const legacyBridgeAbsentBeforeImport = !Reflect.has(globalThis, '__riftyEsbuildTransform');
const require = createRequire(import.meta.url);
const cjs = require('esbuild');
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
  ${JSON.stringify(guestPath(paths.devResult))},
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

function configLauncher(target: string): string {
  const name = target.slice(target.lastIndexOf('/') + 1);
  return `import './${name}';\nexport default {};\n`;
}

function parseResult<T>(
  result: { readonly ok: boolean; readonly text: string; readonly error: string },
  label: string,
): T {
  expect(result.ok, `${label}: ${result.error}`).toBe(true);
  return JSON.parse(result.text) as T;
}

async function reacquireAttestedTree(page: Page, afterMode: string): Promise<void> {
  const result = await execLine(page, 'npm install');
  expect(result.exit, `${afterMode} tree reacquisition: ${result.out}`).toBe(0);
}

async function runContractHarness(page: Page): Promise<{
  readonly dev: FullEnvelope;
  readonly build: ModuleEnvelope;
  readonly preview: ModuleEnvelope;
  readonly optimize: ModuleEnvelope;
}> {
  const token = randomUUID();
  const paths = pathsFor(token);
  const bundle = await bundleProbe();

  await writeOwnerFile(page, paths.devRunner, devRunner(bundle, token, paths));
  await writeOwnerFile(
    page,
    paths.buildRunner,
    moduleRunner(
      bundle,
      token,
      'build',
      `${guestPath(paths.dir)}/build-workspace`,
      guestPath(paths.buildResult),
    ),
  );
  await writeOwnerFile(
    page,
    paths.previewRunner,
    moduleRunner(
      bundle,
      token,
      'preview',
      `${guestPath(paths.dir)}/preview-workspace`,
      guestPath(paths.previewResult),
    ),
  );
  await writeOwnerFile(
    page,
    paths.optimizeRunner,
    moduleRunner(
      bundle,
      token,
      'optimize',
      `${guestPath(paths.dir)}/optimize-workspace`,
      guestPath(paths.optimizeResult),
    ),
  );
  await writeOwnerFile(page, paths.devConfig, configLauncher(paths.devRunner));
  await writeOwnerFile(page, paths.buildConfig, configLauncher(paths.buildRunner));
  await writeOwnerFile(page, paths.previewConfig, configLauncher(paths.previewRunner));
  await writeOwnerFile(page, paths.optimizeConfig, configLauncher(paths.optimizeRunner));

  const devMarker = `RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:dev`;
  const previewMarker = `RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:preview`;
  const dev = await execLineUntil(page, `vite --config ${guestPath(paths.devConfig)}`, devMarker);
  // Vite's default ESM config loader writes node_modules/.vite-temp. The
  // install authority correctly revokes that mutable tree; use its public
  // recovery before the next independent mode instead of weakening trust.
  await reacquireAttestedTree(page, 'dev');
  const build = await execLine(page, `vite build --config ${guestPath(paths.buildConfig)}`);
  await reacquireAttestedTree(page, 'build');
  const preview = await execLineUntil(
    page,
    `vite preview --config ${guestPath(paths.previewConfig)}`,
    previewMarker,
  );
  await reacquireAttestedTree(page, 'preview');
  const optimize = await execLine(
    page,
    `vite optimize --force --config ${guestPath(paths.optimizeConfig)}`,
  );
  await reacquireAttestedTree(page, 'optimize');

  const devFile = await readOwnerFile(page, paths.devResult);
  const buildFile = await readOwnerFile(page, paths.buildResult);
  const previewFile = await readOwnerFile(page, paths.previewResult);
  const optimizeFile = await readOwnerFile(page, paths.optimizeResult);
  const cleanup = await execLine(page, `rm -rf ${paths.dir}`);

  expect(hostEsbuild.version).toBe('0.28.0');
  for (const [mode, result] of [
    ['build', build],
    ['optimize', optimize],
  ] as const) {
    expect(result.exit, `${mode}: ${result.out}`).toBe(0);
    expect(result.out).toContain(`RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:${mode}`);
  }
  for (const [mode, result] of [
    ['dev', dev],
    ['preview', preview],
  ] as const) {
    expect(result.exit, `${mode}: ${result.out}`).toEqual({ code: null, signal: 'SIGTERM' });
    expect(result.out).toContain(`RIFTY_ESBUILD_CONTRACT_COMPLETE:${token}:${mode}`);
  }
  expect(cleanup.exit, cleanup.out).toBe(0);

  const devEnvelope = parseResult<FullEnvelope>(devFile, 'dev full');
  const buildEnvelope = parseResult<ModuleEnvelope>(buildFile, 'build module');
  const previewEnvelope = parseResult<ModuleEnvelope>(previewFile, 'preview module');
  const optimizeEnvelope = parseResult<ModuleEnvelope>(optimizeFile, 'optimize module');

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
  return {
    dev: devEnvelope,
    build: buildEnvelope,
    preview: previewEnvelope,
    optimize: optimizeEnvelope,
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

test('Vite 7 config graph and dependency optimizer use real esbuild over owner VFS', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-esbuild-vite-contract',
    template: 'vite',
    setup: 'instant',
    starter: 'real-vite',
    hiddenEmptyBoot: false,
  });

  try {
    const which = await execLine(page, 'which vite');
    expect(which).toMatchObject({ exit: 0 });
    expect(which.out).toContain(LOGICAL_VITE_BIN);
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
      `import pc from './.rifty-prebundle-picocolors.mjs';
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
    expect(prebundle.ok, prebundle.error).toBe(true);
    await writeOwnerFile(page, '/scratch/.rifty-prebundle-picocolors.mjs', prebundle.text);
    await reacquireAttestedTree(page, 'default optimize');
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
  } finally {
    await closeOwner(page);
  }
});
