import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RegistryClient, type VersionManifest, extractTarGz, install } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { createMemoryFs } from '@riftydev/vfs/internal';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createTsLanguageService } from '../../packages/ts-language-service/src/index.ts';
import { createTestNpmPackageAcquisitionAuthority } from '../../packages/workbench/src/glue/npm-shell-command.test-fixture.ts';
import { createNpmShellCommand } from '../../packages/workbench/src/glue/npm-shell-command.ts';
import { registryFixture, registryUrl } from './fixtures/registry/rollup-companions/fixture.mjs';

const root = '/project';
const source =
  "import { build } from 'esbuild';\nbuild({ write: false });\nbuild({ write: 'wrong' });\n";
const variants = [
  { tier: 'no-coi', version: '0.28.0' },
  { tier: 'coi', version: '0.28.0' },
  { tier: 'coi', version: '0.21.5' },
  { tier: 'coi', version: '0.25.12' },
  { tier: 'coi', version: '0.28.2' },
] as const;
const modes = [
  { name: 'node10', resolution: ts.ModuleResolutionKind.Node10, module: ts.ModuleKind.CommonJS },
  { name: 'node16', resolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16 },
  { name: 'bundler', resolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext },
] as const;

it('the generated esbuild compat page states the declaration surface and its proof', () => {
  const page = readFileSync(
    new URL('../../docs/public/compat/esbuild-js-api.md', import.meta.url),
    'utf8',
  );
  expect(page).toContain('| TypeScript declarations | ✅ |');
  expect(page).toContain('tests/integration/esbuild-declarations.test.ts');
});

it('Vite 7 install exposes the Eddy decline, usable esbuild types and the refused no-COI range', async () => {
  const { vfs, fsSync } = createMemoryFs();
  const fixture = await registryFixture();
  const lightningBytes = readFileSync(
    new URL(
      '../../tools/shadow-registry/src/fixtures/lightningcss-wasm-1.32.0.tgz',
      import.meta.url,
    ),
  );
  const lightningFiles = await extractTarGz(lightningBytes);
  const lightning = JSON.parse(
    new TextDecoder().decode(lightningFiles['package.json']),
  ) as VersionManifest;
  const registry = new RegistryClient({
    baseUrl: registryUrl,
    // Missing optional native archives are a fixture egress boundary, not a retry scenario.
    maxRetries: 0,
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/lightningcss.tgz') return new Response(new Uint8Array(lightningBytes));
      if (path === '/lightningcss-wasm')
        return Response.json({
          name: lightning.name,
          'dist-tags': { latest: lightning.version },
          versions: {
            [lightning.version]: {
              ...lightning,
              dist: {
                tarball: `${registryUrl}/lightningcss.tgz`,
                integrity: `sha512-${createHash('sha512').update(lightningBytes).digest('base64')}`,
              },
            },
          },
        });
      return fixture.fetch(input, init);
    },
  });
  await vfs.mkdir(root, { recursive: true });
  const dependencies = { vite: '7.3.6', esbuild: '^0.28.0', lightningcss: '^1.30.0' };
  const writeProject = () =>
    vfs.writeFile(
      `${root}/package.json`,
      JSON.stringify({ name: 'honest-vite', private: true, dependencies }),
    );
  await writeProject();
  vi.stubGlobal('fetch', async () => {
    throw new Error('resolver unreachable');
  });
  const deps = {
    vfs,
    registry,
    resolverUrl: 'https://eddy.invalid/resolve',
    resolverClosureHash: () => 'a'.repeat(64),
  };
  const shell = new Shell({ cwd: root });
  shell.registerCommand(
    'npm',
    createNpmShellCommand({
      ...deps,
      packageAcquisitionAuthority: createTestNpmPackageAcquisitionAuthority(deps),
    }),
  );
  try {
    const result = await shell.run('npm install');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/npm: installed \d+ package\(s\) in /);
    expect
      .soft(result.stderr)
      .toContain(
        'npm: fast install (eddy) unavailable, using standard install — get: resolver unreachable; post: resolver unreachable',
      );
    expect(
      JSON.parse(await vfs.readFileText(`${root}/node_modules/vite/package.json`)).version,
    ).toBe('7.3.6');
    expect(
      JSON.parse(await vfs.readFileText(`${root}/node_modules/lightningcss/package.json`)).version,
    ).toBe('1.32.0');
    await vfs.mkdir(`${root}/scripts`, { recursive: true });
    await vfs.writeFile(`${root}/scripts/build.ts`, source);
    await vfs.writeFile(
      `${root}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          types: [],
        },
        files: ['scripts/build.ts'],
      }),
    );
    writeCompiler(fsSync);
    const service = await createTsLanguageService({ fsSync, projectRoot: root });
    try {
      expect
        .soft(service.getSemanticDiagnostics(`${root}/scripts/build.ts`).map(({ code }) => code))
        .toEqual([2322]);
      expect
        .soft(service.getDefinition(`${root}/scripts/build.ts`, { line: 1, character: 1 })[0]?.uri)
        .toContain('/node_modules/esbuild-wasm/lib/main.d.ts');
    } finally {
      service.dispose();
    }
    dependencies.esbuild = '^0.21.0';
    await writeProject();
    const refused = await shell.run('npm install');
    expect(refused.exitCode).not.toBe(0);
    expect.soft(refused.stderr).toContain('esbuild@^0.21.0');
    expect.soft(refused.stderr).toContain('0.28.0');
    expect.soft(refused.stderr).toContain('semver-admits');
  } finally {
    vi.unstubAllGlobals();
  }
}, 30_000);

async function archive(version: string, name = 'esbuild-wasm') {
  const directory = version === '0.28.0' ? 'rollup-companions/packages' : 'esbuild-upstream';
  const bytes = readFileSync(
    new URL(`./fixtures/registry/${directory}/${name}-${version}.tgz`, import.meta.url),
  );
  return { bytes, files: await extractTarGz(bytes) };
}

async function installed(tier: 'coi' | 'no-coi', version: string) {
  const upstream = await archive(version);
  const manifest = JSON.parse(
    new TextDecoder().decode(upstream.files['package.json']),
  ) as VersionManifest;
  const origin = 'https://esbuild-types-fixture.test';
  const registry = new RegistryClient({
    baseUrl: origin,
    fetch: async (input) => {
      const path = new URL(input).pathname;
      if (path === '/package.tgz') return new Response(new Uint8Array(upstream.bytes));
      if (path !== '/esbuild-wasm') throw new Error(`Unexpected registry request ${path}`);
      return Response.json({
        name: 'esbuild-wasm',
        'dist-tags': { latest: version },
        versions: {
          [version]: {
            ...manifest,
            dist: {
              tarball: `${origin}/package.tgz`,
              integrity: `sha512-${createHash('sha512').update(upstream.bytes).digest('base64')}`,
            },
          },
        },
      });
    },
  });
  const memory = createMemoryFs();
  await memory.vfs.mkdir(root, { recursive: true });
  await memory.vfs.writeFile(
    `${root}/package.json`,
    JSON.stringify({ dependencies: { esbuild: version } }),
  );
  await install({ vfs: memory.vfs, cwd: root, registry, runtimeTier: tier });
  return { ...memory, upstream };
}

function nativeDiagnostics(directory: string, mode: (typeof modes)[number]) {
  const filename = join(directory, 'scripts/build.ts');
  const program = ts.createProgram([filename], {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: mode.module,
    moduleResolution: mode.resolution,
    types: [],
  });
  return program.getSemanticDiagnostics(program.getSourceFile(filename)).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

function writeNative(directory: string, files: Record<string, Uint8Array>) {
  for (const [path, bytes] of Object.entries(files)) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

async function snapshot(
  vfs: Awaited<ReturnType<typeof installed>>['vfs'],
  directory: string,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of await vfs.readdir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) Object.assign(files, await snapshot(vfs, path));
    else files[path.slice(root.length + 1)] = await vfs.readFile(path);
  }
  return files;
}

function writeCompiler(fsSync: ReturnType<typeof createMemoryFs>['fsSync']) {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve('typescript/package.json'));
  const target = `${root}/node_modules/typescript`;
  fsSync.mkdirSync(`${target}/lib`, { recursive: true });
  fsSync.writeFileSync(`${target}/package.json`, readFileSync(join(packageRoot, 'package.json')));
  for (const name of readdirSync(join(packageRoot, 'lib'))) {
    if (name !== 'typescript.js' && !/^lib(\.[^.]+)*\.d\.ts$/.test(name)) continue;
    fsSync.writeFileSync(`${target}/lib/${name}`, readFileSync(join(packageRoot, 'lib', name)));
  }
}

describe.each(variants)('installed esbuild declarations: $tier $version', ({ tier, version }) => {
  it('resolves the exact published declaration bytes from its types entry', async () => {
    const { vfs, upstream } = await installed(tier, version);
    const manifest = JSON.parse(
      await vfs.readFileText(`${root}/node_modules/esbuild/package.json`),
    );
    expect(manifest.types).toEqual(expect.any(String));
    expect(await vfs.readFile(`${root}/node_modules/esbuild/${manifest.types}`)).toEqual(
      upstream.files['lib/main.d.ts'],
    );
    if (version === '0.28.0') {
      const native = await archive(version, 'esbuild');
      expect(upstream.files['lib/main.d.ts']).toEqual(native.files['lib/main.d.ts']);
    }
  });

  it.each(modes)(
    'matches native declarations in $name resolution and the real VFS language service',
    async (mode) => {
      const { vfs, fsSync, upstream } = await installed(tier, version);
      await vfs.mkdir(`${root}/scripts`, { recursive: true });
      await vfs.writeFile(`${root}/scripts/build.ts`, source);
      const temporary = mkdtempSync(join(tmpdir(), 'rifty-esbuild-types-'));
      try {
        const reference = join(temporary, 'reference');
        const facade = join(temporary, 'installed');
        const referenceFiles =
          version === '0.28.0' ? (await archive(version, 'esbuild')).files : upstream.files;
        writeNative(join(reference, 'node_modules/esbuild'), referenceFiles);
        writeNative(reference, { 'scripts/build.ts': new TextEncoder().encode(source) });
        writeNative(facade, await snapshot(vfs, root));
        const expected = nativeDiagnostics(reference, mode);
        expect(expected).toHaveLength(1);
        expect(expected[0]?.code).toBe(2322);
        expect.soft(nativeDiagnostics(facade, mode)).toEqual(expected);

        writeCompiler(fsSync);
        await vfs.writeFile(
          `${root}/tsconfig.json`,
          JSON.stringify({
            compilerOptions: {
              strict: true,
              skipLibCheck: true,
              target: 'ES2022',
              module:
                mode.name === 'node16' ? 'Node16' : mode.name === 'bundler' ? 'ESNext' : 'CommonJS',
              moduleResolution: mode.name === 'node10' ? 'node' : mode.name,
              types: [],
            },
            files: ['scripts/build.ts'],
          }),
        );
        const service = await createTsLanguageService({ fsSync, projectRoot: root });
        try {
          expect(service.getConfigFileDiagnostics()).toEqual([]);
          expect
            .soft(
              service
                .getSemanticDiagnostics(`${root}/scripts/build.ts`)
                .map(({ code, message }) => ({ code, message })),
            )
            .toEqual(expected);
          const definitions = service.getDefinition(`${root}/scripts/build.ts`, {
            line: 1,
            character: 1,
          });
          expect(definitions).toHaveLength(1);
          expect(definitions[0]?.uri).toContain('/node_modules/esbuild-wasm/lib/main.d.ts');
        } finally {
          service.dispose();
        }
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
