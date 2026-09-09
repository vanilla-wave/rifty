import { readFile } from 'node:fs/promises';
import { RegistryClient, type VersionManifest, startEddyPrefetch } from '@riftydev/npm-client';
import { type CommandContext, Shell } from '@riftydev/shell';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestNpmPackageAcquisitionAuthority } from './npm-shell-command.test-fixture.ts';
import {
  createNpmShellCommand,
  executeNpmInstallOperation,
  parseNpmInstallRequest,
} from './npm-shell-command.ts';

const ROOT = '/project';
const MANIFEST = '{"name":"shell-offline","dependencies":{"ms":"2.0.0"}}\n';
const RESOLVER = 'https://eddy.invalid/resolve';
const HASH = 'a'.repeat(64);
const network: string[] = [];
type OperationDeps = Parameters<typeof executeNpmInstallOperation>[2];

function withoutRegistry(deps: Omit<OperationDeps, 'registry'>): OperationDeps {
  return deps;
}

async function localRegistry() {
  const fixtureRoot = new URL('../../../../tests/integration/fixtures/registry/', import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL('ms-2.0.0.json', fixtureRoot), 'utf8'),
  ) as VersionManifest;
  const tarball = new Uint8Array(await readFile(new URL('ms-2.0.0.tgz', fixtureRoot)));
  const calls = { packument: 0, tarball: 0, unknown: 0 };
  const registry = new RegistryClient({
    baseUrl: 'packument:',
    maxRetries: 0,
    fetch: async (url) => {
      if (url === 'packument:/ms') {
        calls.packument++;
        return Response.json({ name: manifest.name, versions: { [manifest.version]: manifest } });
      }
      if (url === manifest.dist.tarball) {
        calls.tarball++;
        return new Response(tarball.buffer);
      }
      calls.unknown++;
      throw new Error(`unexpected fixture registry URL: ${url}`);
    },
  });
  return { registry, calls };
}

beforeEach(() => {
  network.length = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    network.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response('external acquisition was not allowed', { status: 404 });
  });
});
afterEach(() => {
  try {
    expect(network).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

async function project() {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.mkdir('/pins', { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, MANIFEST);
  return vfs;
}

function callbacks(vfs: Vfs, effects: string[]) {
  return {
    resolverClosureHash: () => {
      effects.push('preset pin');
      return HASH;
    },
    resolverPrefetch: () => {
      effects.push('prefetch getter');
      return startEddyPrefetch({
        resolverUrl: RESOLVER,
        request: { dependencies: { ms: '2.0.0' }, optionalDependencies: {} },
      });
    },
    learnedPins: {
      async get() {
        effects.push('learned pin read');
        return JSON.parse(await vfs.readFileText('/pins/current.json')) as {
          closureHash: string;
          stale: boolean;
        };
      },
      async set(key: string, closureHash: string) {
        effects.push('learned pin write');
        await vfs.writeFile('/pins/written.json', JSON.stringify({ key, closureHash }));
      },
      async revalidate(key: string) {
        effects.push('pin revalidate');
        await (await fetch(RESOLVER, { method: 'POST', body: key })).text();
        await vfs.writeFile('/pins/revalidated.json', key);
      },
    },
  };
}

function context() {
  const output: { stdout: string; stderr: string } = { stdout: '', stderr: '' };
  const decode = (value: string | Uint8Array) =>
    typeof value === 'string' ? value : new TextDecoder().decode(value);
  const ctx: CommandContext = {
    cwd: ROOT,
    env: {},
    stdout: {
      write: (chunk) => {
        output.stdout += decode(chunk);
      },
    },
    stderr: {
      write: (chunk) => {
        output.stderr += decode(chunk);
      },
    },
  };
  return { ctx, output };
}

async function operation(deps: OperationDeps) {
  const parsed = parseNpmInstallRequest([]);
  if (parsed.status !== 'ready') throw new Error(parsed.message);
  const { ctx, output } = context();
  const result = await executeNpmInstallOperation(parsed.request, ctx, deps, {
    sessionInstallActivity: false,
    priorTrustedTree: false,
  });
  return { result, output };
}

it.each([false, true])(
  'absent registry rejects Eddy before host callbacks (stale=%s)',
  async (stale) => {
    const vfs = await project();
    await vfs.writeFile('/pins/current.json', JSON.stringify({ closureHash: HASH, stale }));
    const effects: string[] = [];
    const deps = withoutRegistry({ vfs, resolverUrl: RESOLVER, ...callbacks(vfs, effects) });
    const failure = await operation(deps).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect.soft(failure).toBeInstanceOf(Error);
    expect.soft(effects).toEqual([]);
    expect(await vfs.exists('/pins/written.json')).toBe(false);
    expect(await vfs.exists('/pins/revalidated.json')).toBe(false);
  },
);

it('configured registry keeps the real install path and leaves URL-disabled Eddy callbacks inert', async () => {
  const vfs = await project();
  const local = await localRegistry();
  const { registry } = local;
  const effects: string[] = [];
  const { result, output } = await operation({ vfs, registry, ...callbacks(vfs, effects) });
  expect('result' in result && result.result.provenance.packages).toEqual([
    { name: 'ms', version: '2.0.0', transport: 'registry' },
  ]);
  expect(local.calls).toEqual({ packument: 1, tarball: 1, unknown: 0 });
  expect(await vfs.readFileText(`${ROOT}/node_modules/ms/index.js`)).toContain('module.exports');
  expect(output.stdout).toContain('npm: + ms@2.0.0');
  expect(output.stderr).toBe('');
  expect(effects).toEqual([]);
});

it.each([
  ['npm run verify', 'verify'],
  ['npm --prefix .. run verify', 'verify'],
  ['npm --prefix .. test', 'test'],
  ['npm --prefix .. run fail', 'fail'],
] as const)('local lifecycle remains real with no registry: %s', async (line, name) => {
  const pair = createMemoryFs();
  await pair.vfs.mkdir(`${ROOT}/nested`, { recursive: true });
  await pair.vfs.writeFile(`${ROOT}/message.txt`, 'local file bytes\n');
  const main = name === 'fail' ? 'false' : 'pwd && cat message.txt';
  await pair.vfs.writeFile(
    `${ROOT}/package.json`,
    JSON.stringify({
      name: 'local-scripts',
      scripts: { [`pre${name}`]: 'echo before', [name]: main, [`post${name}`]: 'echo after' },
    }),
  );
  const base = withoutRegistry({
    vfs: pair.vfs,
    runScript: async (_name: string, command: string, ctx: CommandContext) => {
      const runner = new Shell({ cwd: ctx.cwd, env: ctx.env, fileSystem: pair.fsSync });
      return (
        await runner.run(command, {
          onChunk: (chunk, stream) => {
            ctx[stream].write(chunk);
          },
        })
      ).exit;
    },
  });
  const packages = createTestNpmPackageAcquisitionAuthority(base);
  const shell = new Shell({ cwd: `${ROOT}/nested`, fileSystem: pair.fsSync });
  shell.registerCommand(
    'npm',
    createNpmShellCommand({ ...base, packageAcquisitionAuthority: packages }),
  );
  try {
    const result = await shell.run(line);
    expect(result.exitCode).toBe(name === 'fail' ? 1 : 0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      name === 'fail'
        ? '> echo before\nbefore\n> false\n'
        : '> echo before\nbefore\n> pwd && cat message.txt\n/project\nlocal file bytes\n> echo after\nafter\n',
    );
    expect(shell.cwd).toBe(`${ROOT}/nested`);
    expect(await pair.vfs.exists(`${ROOT}/package-lock.json`)).toBe(false);
  } finally {
    await packages.quiesce();
  }
});
