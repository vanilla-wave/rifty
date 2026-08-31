#!/usr/bin/env node
/**
 * esbuild/Vite cutover deletion ratchet.
 *
 * Browser parity proves the registry adapter. This finite inventory proves the
 * retired ADR-0047 vendored-WASI and Pattern-2 asset carriers cannot remain
 * beside it or return.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

const SELF = new Set([
  'tools/checks/esbuild-legacy-retirement.mjs',
  'tools/checks/esbuild-legacy-retirement.test.ts',
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
  }
  return violations;
}

function main() {
  const violations = evaluateEsbuildLegacyRetirement(process.cwd());
  if (violations.length > 0) {
    console.error(`esbuild-legacy-retirement: ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `esbuild-legacy-retirement: ${RETIRED_ESBUILD_PATHS.length} paths and ${RETIRED_ESBUILD_REFERENCES.length} references absent`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
