import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { install } from './installer.ts';
import { shadowSubstitutionPlanForInstallResult } from './internal/shadow/install-result.ts';
import { RegistryClient, type VersionManifest } from './registry.ts';
import { extractTarGz } from './unpacker.ts';

const versions = ['0.21.5', '0.25.12', '0.28.2'];
const root = '/project';
async function fixture(requested: string) {
  const entries = await Promise.all(
    [...new Set([requested, '0.28.0'])].map(async (version) => {
      const location =
        version === '0.28.0'
          ? `../../../tests/integration/fixtures/registry/rollup-companions/packages/esbuild-wasm-${version}.tgz`
          : `../../../tests/integration/fixtures/registry/esbuild-upstream/esbuild-wasm-${version}.tgz`;
      const bytes = readFileSync(new URL(location, import.meta.url));
      const files = await extractTarGz(bytes);
      const manifest = JSON.parse(
        new TextDecoder().decode(files['package.json']),
      ) as VersionManifest;
      return {
        version,
        bytes,
        files,
        manifest: {
          ...manifest,
          dist: {
            tarball: `https://upstream-fixture.test/esbuild-wasm-${version}.tgz`,
            integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          },
        },
      };
    }),
  );
  const requests: string[] = [];
  const registry = new RegistryClient({
    baseUrl: 'https://upstream-fixture.test',
    fetch: async (input) => {
      const path = new URL(input).pathname;
      requests.push(path);
      const entry = entries.find((entry) => path === `/esbuild-wasm-${entry.version}.tgz`);
      if (entry) return new Response(new Uint8Array(entry.bytes));
      if (path !== '/esbuild-wasm') throw new Error(`Unexpected registry request ${path}`);
      return Response.json({
        name: 'esbuild-wasm',
        'dist-tags': { latest: '0.28.2' },
        versions: Object.fromEntries(entries.map((entry) => [entry.version, entry.manifest])),
      });
    },
  });
  const vfs = new MemoryVfs();
  await vfs.mkdir(root, { recursive: true });
  return { entries, requests, registry, vfs };
}
async function manifest(vfs: MemoryVfs, range: string) {
  await vfs.writeFile(
    `${root}/package.json`,
    JSON.stringify({ name: 'upstream-twin', private: true, dependencies: { esbuild: range } }),
  );
}

describe('upstream esbuild install policy', () => {
  for (const version of versions)
    it.fails(
      `COI resolves ${version}, preserves upstream tree/types, replays offline`,
      async () => {
        const f = await fixture(version);
        await manifest(f.vfs, `^${version.split('.').slice(0, 2).join('.')}.0`);
        const reports: string[] = [];
        const options = {
          vfs: f.vfs,
          cwd: root,
          registry: f.registry,
          runtimeTier: 'coi' as const,
          onSubstitution: (line: string) => reports.push(line),
        };
        const result = await install(options);
        expect(shadowSubstitutionPlanForInstallResult(result).bindings).toEqual([]);
        const installed = JSON.parse(
          await f.vfs.readFileText(`${root}/node_modules/esbuild/package.json`),
        );
        expect(installed.version).toBe(version);
        const expected = f.entries.find((entry) => entry.version === version)!;
        for (const [path, bytes] of Object.entries(expected.files)) {
          expect(await f.vfs.readFile(`${root}/node_modules/esbuild-wasm/${path}`)).toEqual(bytes);
        }
        expect(await f.vfs.readFile(`${root}/node_modules/esbuild/${installed.types}`)).toEqual(
          expected.files['lib/main.d.ts'],
        );
        expect(await f.vfs.exists(`${root}/node_modules/.bin/esbuild`)).toBe(true);
        expect(reports.join('\n')).toContain(`esbuild-wasm@${version}`);
        const lock = await f.vfs.readFileText(`${root}/package-lock.json`);
        const before = f.requests.length;
        await f.vfs.rm(`${root}/node_modules`, { recursive: true });
        await install({ ...options, registry: undefined });
        expect(f.requests.length).toBe(before);
        expect(await f.vfs.readFileText(`${root}/package-lock.json`)).toBe(lock);
        expect(await f.vfs.readFile(`${root}/node_modules/esbuild-wasm/lib/main.js`)).toEqual(
          expected.files['lib/main.js'],
        );
      },
      60_000,
    );

  it.fails(
    'no-COI retains the 0.28.0 runtime and names its rejected tier',
    async () => {
      const f = await fixture('0.28.2');
      await manifest(f.vfs, '^0.28.0');
      const options = {
        vfs: f.vfs,
        cwd: root,
        registry: f.registry,
        runtimeTier: 'no-coi' as const,
      };
      const result = await install(options);
      expect(shadowSubstitutionPlanForInstallResult(result).bindings).toHaveLength(1);
      const installed = JSON.parse(
        await f.vfs.readFileText(`${root}/node_modules/esbuild/package.json`),
      );
      expect(installed.version).toBe('0.28.0');
      await manifest(f.vfs, '^0.25.0');
      await expect(install(options)).rejects.toMatchObject({
        name: 'NotImplementedError',
        message: expect.stringContaining('no-COI'),
      });
    },
    60_000,
  );

  it.fails(
    'a COI lock pinning 0.28.2 cannot silently run as 0.28.0 without COI',
    async () => {
      const f = await fixture('0.28.2');
      await manifest(f.vfs, '^0.28.0');
      const options = { vfs: f.vfs, cwd: root, registry: f.registry, runtimeTier: 'coi' as const };
      await install(options);
      const lock = await f.vfs.readFileText(`${root}/package-lock.json`);
      const noCoiOptions = { ...options, runtimeTier: 'no-coi' as const };
      const failure = await install(noCoiOptions).then(
        () => null,
        (error: Error) => ({ name: error.name, message: error.message }),
      );
      expect(failure).toMatchObject({
        name: 'NotImplementedError',
        message: expect.stringContaining('no-COI'),
      });
      expect(await f.vfs.readFileText(`${root}/package-lock.json`)).toBe(lock);
    },
    60_000,
  );
});
