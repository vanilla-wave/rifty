#!/usr/bin/env node
/**
 * esbuild carrier deletion ratchet and emitted-output inventory.
 *
 * Browser parity proves the registry adapter. This finite inventory proves the
 * retired vendored-WASI and Pattern-2 asset carriers cannot remain or return.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RETIRED_ESBUILD_PATHS = Object.freeze([
  'packages/npm-client/src/internal/shadow/manager.ts',
  'packages/npm-client/src/internal/shadow/port.ts',
  'packages/npm-client/src/internal/shadow/source.ts',
  'packages/workbench/src/workers/owner-shadow-assets.ts',
  'tests/integration/esbuild-wasi-transform.test.ts',
  'tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs',
  'tools/shadow-registry/src/esbuild-binding.ts',
  'tools/shadow-registry/src/esbuild-transform.test.ts',
  'tools/shadow-registry/src/esbuild-transform.ts',
  'tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm',
]);

export const RETIRED_ESBUILD_REFERENCES = Object.freeze([
  'KernelEntryCapabilityPorts',
  'OriginExclusiveShadowAssetManager',
  'PackageTreeShadowAssetBoundary',
  'SHADOW_ASSET_PORT_CAPABILITY',
  'ShadowAssetPlan',
  'ShadowAssetPortServer',
  'ShadowAssetReadySet',
  'ShadowAssetStorageClass',
  'ShadowAssetVfsDurability',
  'ShadowRuntimeAsset',
  '@riftydev/shadow-registry/esbuild-binding',
  '@riftydev/shadow-registry/esbuild-transform',
  'capabilityPorts',
  'consumeKernelEntryCapabilityPorts',
  'createMemoryShadowAssetStorage',
  'createOriginExclusiveShadowAssetManager',
  'createRegistryShadowAssetSource',
  'createShadowAssetPortClient',
  'createVfsShadowAssetStorage',
  'ESBUILD_WASM_VENDOR_PATH',
  'loadVendoredEsbuildWasm',
  'probeBrowserShadowAssetStorageClass',
  'shadowAssetPlanForInstallResult',
  'shadowAssets',
  'fetch-esbuild-wasi.mjs',
]);

export const ALLOWED_SHADOW_PRODUCTION_SOURCES = Object.freeze([
  'packages/npm-client/src/internal/shadow/admission.ts',
  'packages/npm-client/src/internal/shadow/index.ts',
  'packages/npm-client/src/internal/shadow/install-result.ts',
  'packages/npm-client/src/internal/shadow/planner.ts',
  'packages/npm-client/src/internal/shadow/schema-one-identity.ts',
  'packages/npm-client/src/internal/shadow/substitution.ts',
]);

export const ALLOWED_COORDINATION_SOURCES = Object.freeze([
  'packages/workbench/src/glue/vfs-snapshot-port.ts',
  'packages/workbench/src/workbench/service-worker-control.ts',
  'packages/workbench/src/workers/generated/esbuild-runtime.js',
]);

const SELF = new Set([
  'tools/checks/esbuild-legacy-retirement.mjs',
  'tools/checks/esbuild-legacy-retirement.test.ts',
  'packages/kernel/tests/entry-bootstrap-public-surface.test.ts',
]);

const DIST_ROOTS = Object.freeze([
  'packages/workbench/dist',
  'packages/npm-client/dist',
  'tools/shadow-registry/dist',
]);
const PUBLISHED_PACKAGE_ROOTS = Object.freeze([
  'packages/workbench',
  'packages/npm-client',
  'tools/shadow-registry',
]);
const EXPECTED_PACKAGE_FILES = Object.freeze(['dist', 'CHANGELOG.md']);
const GENERATED_CLIENT_SHA256 = '7acc5cd6f0e111810d3505c0959ec2fb5767f25af8dd2c5919a5b36d4f4da553';
const ESBUILD_WASM_BYTES = 13_918_738;
const MAX_PUBLISHED_OUTPUT_BYTES = 2_000_000;
const LARGE_BASE64_RUN = /[A-Za-z0-9+/]{1000000,}={0,2}/u;
const COORDINATION_SOURCE =
  /\b(?:BroadcastChannel|MessageChannel|MessagePort|SharedWorker|WebSocket|WebTransport|postMessage)\b/u;
const RETIRED_BUNDLE_TOKENS = Object.freeze([
  'ShadowAssetPlan',
  'capabilityPorts',
  'createOriginExclusiveShadowAssetManager',
  'createShadowAssetPortClient',
  'requiredSetDigest',
  'rifty.shadow-assets.ready/v1',
]);

function trackedFiles(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

export function evaluateEsbuildLegacyRetirement(
  root,
  files = trackedFiles(root),
  {
    pathExists = (path) => existsSync(`${root}/${path}`),
    readTracked = (path) => readFileSync(`${root}/${path}`, 'utf8'),
  } = {},
) {
  const violations = [];
  for (const path of RETIRED_ESBUILD_PATHS) {
    if (pathExists(path)) violations.push(`${path}: retired path still exists`);
  }
  for (const path of files) {
    if (
      SELF.has(path) ||
      path.startsWith('docs/') ||
      path === 'CHANGELOG.md' ||
      path.endsWith('/CHANGELOG.md') ||
      !/\.(?:[cm]?[jt]s|[jt]sx|json)$/u.test(path)
    ) {
      continue;
    }
    let source;
    try {
      source = readTracked(path);
    } catch {
      continue;
    }
    for (const reference of RETIRED_ESBUILD_REFERENCES) {
      if (source.includes(reference)) {
        violations.push(`${path}: retired reference ${JSON.stringify(reference)}`);
      }
    }
    if (
      path.startsWith('packages/npm-client/src/internal/shadow/') &&
      path.endsWith('.ts') &&
      !path.includes('.test.') &&
      !path.includes('/fixtures/') &&
      !ALLOWED_SHADOW_PRODUCTION_SOURCES.includes(path)
    ) {
      violations.push(`${path}: unapproved shadow production source`);
    }
    if (
      (path.startsWith('packages/workbench/src/') ||
        path.startsWith('packages/npm-client/src/') ||
        path.startsWith('tools/shadow-registry/src/')) &&
      !path.includes('.test.') &&
      !path.includes('/_test-fixtures/') &&
      COORDINATION_SOURCE.test(source) &&
      !ALLOWED_COORDINATION_SOURCES.includes(path)
    ) {
      violations.push(`${path}: coordination source is outside the exact allowed inventory`);
    }
  }
  return violations;
}

export function evaluateEsbuildPackagePacklists(
  root,
  readManifest = (path) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8')),
) {
  const violations = [];
  for (const packageRoot of PUBLISHED_PACKAGE_ROOTS) {
    const manifestPath = `${packageRoot}/package.json`;
    let manifest;
    try {
      manifest = readManifest(manifestPath);
    } catch {
      violations.push(`${manifestPath}: package manifest is unreadable`);
      continue;
    }
    if (JSON.stringify(manifest.files) !== JSON.stringify(EXPECTED_PACKAGE_FILES)) {
      violations.push(
        `${manifestPath}: packed files must be exactly ${JSON.stringify(EXPECTED_PACKAGE_FILES)}`,
      );
    }
  }
  return violations;
}

function outputFiles(root) {
  const files = [];
  const walk = (relative) => {
    for (const name of readdirSync(`${root}/${relative}`)) {
      const path = `${relative}/${name}`;
      if (statSync(`${root}/${path}`).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  for (const relative of DIST_ROOTS) {
    if (!existsSync(`${root}/${relative}`)) return null;
    walk(relative);
  }
  return files;
}

export function evaluateEsbuildBundleInventory(
  root,
  files = outputFiles(root),
  readOutput = (path) => readFileSync(`${root}/${path}`),
) {
  if (files === null) return ['build outputs missing; run pnpm build:libs'];
  const violations = [];
  const generatedClients = [];
  for (const path of files) {
    const bytes = readOutput(path);
    if (path.endsWith('.wasm')) violations.push(`${path}: runtime wasm shipped in package output`);
    if (bytes.byteLength >= ESBUILD_WASM_BYTES) {
      violations.push(`${path}: output is large enough to inline the esbuild wasm member`);
    }
    if (bytes.byteLength > MAX_PUBLISHED_OUTPUT_BYTES) {
      violations.push(`${path}: published output exceeds the exact 2 MB carrier ceiling`);
    }
    const text = bytes.toString('utf8');
    if (path.endsWith('.js') && text.includes('AGFzbQ')) {
      violations.push(`${path}: output contains an inline WebAssembly base64 prefix`);
    }
    if (text.includes('H4sI') || LARGE_BASE64_RUN.test(text)) {
      violations.push(`${path}: output contains a packed runtime-byte candidate`);
    }
    if (bytes.includes(Buffer.from([0x1f, 0x8b, 0x08]))) {
      violations.push(`${path}: output contains a gzip payload`);
    }
    if (!path.endsWith('.js.map')) continue;
    let map;
    try {
      map = JSON.parse(text);
    } catch {
      violations.push(`${path}: source map is not valid JSON`);
      continue;
    }
    const sources = Array.isArray(map.sources) ? map.sources : [];
    const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = typeof sources[index] === 'string' ? sources[index] : '';
      const content = typeof contents[index] === 'string' ? contents[index] : '';
      if (createHash('sha256').update(content).digest('hex') === GENERATED_CLIENT_SHA256) {
        generatedClients.push({ path, source, content });
      }
      for (const token of RETIRED_BUNDLE_TOKENS) {
        if (content.includes(token)) {
          violations.push(
            `${path}:${source}: retired emitted source token ${JSON.stringify(token)}`,
          );
        }
      }
    }
  }
  if (generatedClients.length !== 1) {
    violations.push(
      `emitted generated esbuild client count is ${generatedClients.length}, expected 1`,
    );
  } else {
    if (!generatedClients[0].source.endsWith('/src/workers/generated/esbuild-runtime.js')) {
      violations.push(
        `emitted generated esbuild client source is ${generatedClients[0].source}, expected the recorded generated source`,
      );
    }
    const digest = createHash('sha256').update(generatedClients[0].content).digest('hex');
    if (digest !== GENERATED_CLIENT_SHA256) {
      violations.push(
        `emitted generated esbuild client sha256 is ${digest}, expected ${GENERATED_CLIENT_SHA256}`,
      );
    }
  }
  return violations;
}

function main() {
  const violations = [
    ...evaluateEsbuildLegacyRetirement(process.cwd()),
    ...evaluateEsbuildPackagePacklists(process.cwd()),
    ...evaluateEsbuildBundleInventory(process.cwd()),
  ];
  if (violations.length > 0) {
    console.error(`esbuild-legacy-retirement: ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `esbuild-legacy-retirement: ${RETIRED_ESBUILD_PATHS.length} paths, ${RETIRED_ESBUILD_REFERENCES.length} references, and exact emitted inventory verified`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
