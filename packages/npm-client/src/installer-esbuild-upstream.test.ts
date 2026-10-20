import { Buffer as NativeBuffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function tree(
  vfs: MemoryVfs,
  directory: string,
  prefix = '',
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await vfs.readdir(directory)) {
    const path = `${directory}/${entry.name}`;
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory) Object.assign(result, await tree(vfs, path, `${name}/`));
    else
      result[name] = createHash('sha256')
        .update(await vfs.readFile(path))
        .digest('hex');
  }
  return result;
}

/** Execute exactly the installed facade/bin bytes on Node, including named imports. */
async function assertNodeFacade(vfs: MemoryVfs, version: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'rifty-range-facade-'));
  try {
    for (const path of Object.keys(await tree(vfs, `${root}/node_modules`))) {
      const target = join(temporary, 'node_modules', path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, await vfs.readFile(`${root}/node_modules/${path}`));
    }
    const code =
      "import esbuild, {version, transform} from 'esbuild';const r=await transform('let n: number = 1',{loader:'ts'});console.log(JSON.stringify({version,same:esbuild.version===version,code:r.code}));esbuild.stop();";
    const run = (packageName: string) =>
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', code.replace("from 'esbuild'", `from '${packageName}'`)],
        { cwd: temporary, encoding: 'utf8', timeout: 30000 },
      );
    const result = JSON.parse(run('esbuild'));
    expect(result).toEqual(JSON.parse(run('esbuild-wasm')));
    expect(result.version).toBe(version);
    expect(
      execFileSync(process.execPath, ['node_modules/.bin/esbuild', '--version'], {
        cwd: temporary,
        encoding: 'utf8',
        timeout: 30000,
      }),
    ).toBe(`${version}\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

describe('upstream esbuild install policy', () => {
  for (const version of versions)
    it(`COI resolves ${version}, preserves upstream tree/types, replays offline`, async () => {
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
        expect(
          NativeBuffer.compare(
            await f.vfs.readFile(`${root}/node_modules/esbuild-wasm/${path}`),
            bytes,
          ),
          path,
        ).toBe(0);
      }
      expect(await f.vfs.readFile(`${root}/node_modules/esbuild/${installed.types}`)).toEqual(
        expected.files['lib/main.d.ts'],
      );
      expect(await f.vfs.exists(`${root}/node_modules/.bin/esbuild`)).toBe(true);
      expect(reports.join('\n')).toContain(`esbuild-wasm@${version}`);
      const expectedTree = Object.fromEntries(
        Object.entries(expected.files).map(([path, bytes]) => [
          path,
          createHash('sha256').update(bytes).digest('hex'),
        ]),
      );
      expect(await tree(f.vfs, `${root}/node_modules/esbuild-wasm`)).toEqual(expectedTree);
      await assertNodeFacade(f.vfs, version);

      const lock = await f.vfs.readFileText(`${root}/package-lock.json`);
      const before = f.requests.length;
      await f.vfs.rm(`${root}/node_modules`, { recursive: true });
      await install({ ...options, registry: undefined });
      expect(f.requests.length).toBe(before);
      expect(await f.vfs.readFileText(`${root}/package-lock.json`)).toBe(lock);
      expect(await tree(f.vfs, `${root}/node_modules/esbuild-wasm`)).toEqual(expectedTree);
      expect(await f.vfs.readFile(`${root}/node_modules/esbuild-wasm/lib/main.js`)).toEqual(
        expected.files['lib/main.js'],
      );
    }, 60_000);

  it('no-COI retains the 0.28.0 runtime and names its rejected tier', async () => {
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
  }, 60_000);

  it('a COI lock pinning 0.28.2 cannot silently run as 0.28.0 without COI', async () => {
    const f = await fixture('0.28.2');
    await manifest(f.vfs, '^0.28.0');
    const options = { vfs: f.vfs, cwd: root, registry: f.registry, runtimeTier: 'coi' as const };
    await install(options);
    const lock = await f.vfs.readFileText(`${root}/package-lock.json`);
    const beforeTree = await tree(f.vfs, `${root}/node_modules`);
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
    expect(await tree(f.vfs, `${root}/node_modules`)).toEqual(beforeTree);
  }, 60_000);
  it.each(['recipe', 'version', 'file', 'legacy-version'] as const)(
    'rejects corrupt dynamic %s identity before publication',
    async (field) => {
      const legacy = field === 'legacy-version';
      const f = await fixture(legacy ? '0.28.0' : '0.25.12');
      await manifest(f.vfs, legacy ? '^0.28.0' : '^0.25.0');
      const options = {
        vfs: f.vfs,
        cwd: root,
        registry: f.registry,
        runtimeTier: legacy ? ('no-coi' as const) : ('coi' as const),
        onSubstitution: () => {},
      };
      await install(options);
      const beforeTree = await tree(f.vfs, `${root}/node_modules`);
      const lock = JSON.parse(await f.vfs.readFileText(`${root}/package-lock.json`));
      const fact = lock.rifty.shadowSubstitutions.applied[0];
      if (field === 'recipe') fact.recipeDigest = '0'.repeat(64);
      else if (field === 'version' || field === 'legacy-version') fact.trigger.version = '0.28.2';
      else fact.materialization.files[0].sha256 = '0'.repeat(64);
      const tampered = JSON.stringify(lock);
      await f.vfs.writeFile(`${root}/package-lock.json`, tampered);
      const failure = await install({ ...options, registry: undefined }).then(
        () => null,
        (error: { code?: string }) => error.code,
      );
      expect(failure).toBe('EBROKENLOCK');
      expect(await f.vfs.readFileText(`${root}/package-lock.json`)).toBe(tampered);
      expect(await tree(f.vfs, `${root}/node_modules`)).toEqual(beforeTree);
    },
  );
});
