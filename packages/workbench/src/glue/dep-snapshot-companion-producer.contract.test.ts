import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Lockfile, RegistryClient, install } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inputFixture,
  registryFixture,
  registryUrl,
} from '../../../../tests/integration/fixtures/registry/rollup-companions/fixture.mjs';
import { produceDependencySnapshot } from '../index.ts';

const companion = 'node_modules/@rollup/wasm-node';
const estree = 'node_modules/@types/estree';
const directories: string[] = [];
type InputName = Parameters<typeof inputFixture>[0];

async function prepare(name: InputName, mutate?: (lock: Lockfile) => void) {
  const input = await inputFixture(name === 'retained' ? 'root' : name);
  let lock = JSON.parse(input.packageLockText) as Lockfile;
  const http = await registryFixture();
  vi.stubGlobal('fetch', http.fetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (name === 'retained') {
    const { vfs } = createMemoryFs();
    await vfs.mkdir('/project', { recursive: true });
    await vfs.writeFile('/project/package.json', input.packageJsonText);
    lock = (
      await install({
        vfs,
        cwd: '/project',
        registry: new RegistryClient({ baseUrl: registryUrl, fetch: http.fetch, maxRetries: 0 }),
      })
    ).lockfile;
    http.requests.length = 0;
  }
  mutate?.(lock);
  return {
    lock,
    http,
    options: {
      ...input,
      packageLockText: JSON.stringify(lock),
      registryUrl,
      templateId: `companion-${name}`,
    },
  };
}

function identity(lock: Lockfile, path: string) {
  const entry = lock.packages[path];
  if (!entry) throw new Error(`Expected output lock pin ${path}`);
  return { version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
}

async function extract(archive: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), 'rifty-companion-producer-'));
  directories.push(root);
  const archivePath = join(root, 'snapshot.tar.gz');
  await writeFile(archivePath, archive);
  execFileSync('tar', ['-xzf', archivePath, '-C', root]);
  const lock = JSON.parse(
    await readFile(join(root, 'payload/package-lock.json'), 'utf8'),
  ) as Lockfile;
  return { root, lock };
}

/** Execute the acquired WASM parser and generated bundle, using real Node. */
async function executeRollup(root: string, triggerPath: string) {
  await writeFile(join(root, 'entry.mjs'), 'export const answer = 6 * 7;\n');
  const script = `
    const { createRequire } = require('node:module');
    const { writeFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const source = createRequire(resolve('payload', ${JSON.stringify(triggerPath)}, 'package.json'));
    (async () => {
      const bundle = await source('./dist/rollup.js').rollup({ input: resolve('entry.mjs') });
      const { output } = await bundle.generate({ format: 'cjs' });
      writeFileSync('answer.cjs', output[0].code);
      console.log(JSON.stringify({
        answer: require(resolve('answer.cjs')).answer,
        companionVersion: source('@rollup/wasm-node/package.json').version,
      }));
      await bundle.close();
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['--eval', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as { answer: number; companionVersion: string };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('public producer admits only actual declared companion acquisitions', () => {
  it('[fault: sibling-drift] produces executable Rollup from the caller ordinary npm lock', async () => {
    const { options, lock, http } = await prepare('root');
    const snapshot = await produceDependencySnapshot(options);
    const output = await extract(snapshot.archive);
    for (const path of Object.keys(output.lock.packages)) {
      if (path === '' || path === companion) continue;
      expect(identity(output.lock, path)).toEqual(identity(lock, path));
    }
    expect(output.lock.packages[companion]?.version).toBe('4.63.1');
    expect(await executeRollup(output.root, 'node_modules/rollup')).toEqual({
      answer: 42,
      companionVersion: '4.63.1',
    });
    expect(
      http.requests
        .filter(({ url }) => !url.endsWith('.tgz'))
        .map(({ url }) => decodeURIComponent(new URL(url).pathname)),
    ).toEqual(['/@rollup/wasm-node']);
  });

  it('[fault: lossy-aggregate] refuses a changed retained companion identity after trigger pin drift', async () => {
    const older = JSON.parse((await inputFixture('conflict')).packageLockText) as Lockfile;
    const { options } = await prepare('retained', (lock) => {
      // A retained source pin is never replaceable merely because the current
      // declared companion requires a different version at the same path.
      lock.packages[companion] = { ...older.packages[companion]! };
    });
    await expect(produceDependencySnapshot(options)).rejects.toThrow(
      'Dependency snapshot requires a caller lockfile pin for node_modules/@rollup/wasm-node',
    );
  });

  it.each(['integrity', 'resolved'] as const)(
    'retains an existing caller companion %s instead of replacing it from metadata',
    async (field) => {
      const original = await registryFixture();
      const retainedUrl = `${registryUrl}/retained-wasm-node-4.63.1.tgz`;
      const bytes = original.tarball('@rollup/wasm-node', '4.63.1');
      const state = await prepare('retained', (lock) => {
        lock.packages[companion]![field] =
          field === 'resolved'
            ? retainedUrl
            : `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
      });
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === retainedUrl) return new Response(new Uint8Array(bytes).buffer);
        return state.http.fetch(input, init);
      });
      const output = await extract((await produceDependencySnapshot(state.options)).archive);
      expect(identity(output.lock, companion)).toEqual(identity(state.lock, companion));
      expect(state.http.requests.filter(({ url }) => !url.endsWith('.tgz'))).toEqual([]);
      if (field === 'integrity') {
        expect(await executeRollup(output.root, 'node_modules/rollup')).toEqual({
          answer: 42,
          companionVersion: '4.63.1',
        });
      }
    },
  );

  it('[fault: corrupt-input] refuses a missing ordinary dependency of the retained trigger', async () => {
    const { options } = await prepare('root', (lock) => {
      Reflect.deleteProperty(lock.packages, estree);
    });
    await expect(produceDependencySnapshot(options)).rejects.toMatchObject({
      code: 'EBROKENLOCK',
      packageName: '@types/estree',
      reason: 'missing-entry',
    });
  });

  it('[fault: provenance-lie] does not let a companion authorize its unpinned ordinary child', async () => {
    const { options } = await prepare('root', (lock) => {
      // Remove the caller's ordinary source edge and pin; original WASM metadata
      // still requires @types/estree. Only this intentional lock fault is changed.
      Reflect.deleteProperty(lock.packages['node_modules/rollup']!.dependencies!, '@types/estree');
      Reflect.deleteProperty(lock.packages, estree);
    });
    await expect(produceDependencySnapshot(options)).rejects.toThrow(
      'Dependency snapshot requires a caller lockfile pin for node_modules/@types/estree',
    );
  });

  it('keeps unsupported ordinary Rollup/companion bin co-demand loud', async () => {
    const state = await prepare('root');
    const input = await inputFixture('retained');
    // Real npm permits both root dependencies. Existing rifty bin-claim policy
    // rejects their shared rollup command; this is no new companion capability.
    await expect(produceDependencySnapshot({ ...state.options, ...input })).rejects.toThrow(
      /bin-collision-reify/,
    );
  });

  it('[fault: lossy-aggregate] preserves nested caller pins while adding only declared companions', async () => {
    const { options, lock } = await prepare('nested');
    const output = await extract((await produceDependencySnapshot(options)).archive);
    const nestedCompanion = `node_modules/vite/node_modules/rollup/${companion}`;
    const additions = Object.keys(output.lock.packages).filter((path) => !lock.packages[path]);
    expect(additions.sort()).toEqual(
      [companion, 'node_modules/esbuild-wasm', nestedCompanion].sort(),
    );
    for (const [path, entry] of Object.entries(lock.packages)) {
      const npmOptional = (entry as typeof entry & { readonly optional?: boolean }).optional;
      if (path === '' || npmOptional || path === 'node_modules/esbuild') continue;
      expect(identity(output.lock, path)).toEqual(identity(lock, path));
    }
    expect(output.lock.packages[companion]?.version).toBe('4.42.0');
    expect(output.lock.packages[nestedCompanion]?.version).toBe('4.63.1');
    expect(await executeRollup(output.root, 'node_modules/rollup')).toEqual({
      answer: 42,
      companionVersion: '4.42.0',
    });
    expect(await executeRollup(output.root, 'node_modules/vite/node_modules/rollup')).toEqual({
      answer: 42,
      companionVersion: '4.63.1',
    });
  }, 90_000);

  it('[fault: corrupt-input] refuses changed retained companion bytes before emitting an artifact', async () => {
    const { options, http } = await prepare('retained');
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const response = await http.fetch(input, init);
      if (!url.endsWith('/wasm-node-4.63.1.tgz')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
      return new Response(bytes.buffer);
    });
    await expect(produceDependencySnapshot(options)).rejects.toThrow(/integrity/i);
  });
});
