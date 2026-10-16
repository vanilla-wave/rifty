import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { matchesRange, pickBestVersion } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import runtimePolicy from '../../../../tools/shadow-registry/esbuild-runtime-policy.json';
import { buildProjectPackageJson } from './project-spec.ts';
import { allProjectSpecs } from './registry.ts';

const supportedVersion = runtimePolicy.consumer.version;
const vite7Templates = allProjectSpecs().filter((spec) => {
  const request = { ...spec.install, ...spec.devDependencies }.vite;
  return request !== undefined && matchesRange(supportedVersion, request);
});

describe('starter Vite version admission', () => {
  it.each(vite7Templates)('$id cannot resolve the unsupported patch observed in CI', (spec) => {
    const pkg = JSON.parse(buildProjectPackageJson(spec).json) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const request = { ...pkg.dependencies, ...pkg.devDependencies }.vite;
    if (request === undefined) throw new Error('Vite starter omitted its dependency');
    expect(pickBestVersion([supportedVersion, '7.3.7'], request)).toBe(supportedVersion);
  });

  it.each(vite7Templates.filter((spec) => spec.bakedNodeModulesUrl !== undefined))(
    '$id baked request and installed Vite agree with runtime admission',
    (spec) => {
      if (spec.bakedNodeModulesUrl === undefined) throw new Error('snapshot URL missing');
      const snapshot = JSON.parse(
        gunzipSync(
          readFileSync(new URL(`../../public${spec.bakedNodeModulesUrl}`, import.meta.url)),
        ).toString('utf8'),
      ) as { deps: Record<string, string>; lockfile: string };
      const lock = JSON.parse(snapshot.lockfile) as {
        packages: Record<string, { version?: string }>;
      };
      expect(snapshot.deps.vite).toBe(supportedVersion);
      expect(lock.packages['node_modules/vite']?.version).toBe(supportedVersion);
    },
  );
});
