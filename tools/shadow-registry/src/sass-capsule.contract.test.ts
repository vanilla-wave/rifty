import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import deadlockFixture from './fixtures/sass-1.100.0-async-importer-deadlock.json';
import embeddedFixture from './fixtures/sass-embedded-1.100.0-contract.json';
import { builtinShadowSubstitutionCatalog } from './internal/index.ts';
import {
  type SassContractApi,
  type SassContractModules,
  type SassContractTranscript,
  probeSassContract,
  sassFacadeContract,
} from './test-sass-contract-probe.ts';

const decoder = new TextDecoder();
const oracleTarballs = [
  ['sass', 'sass-1.100.0.tgz'],
  ['chokidar', 'chokidar-5.0.0.tgz'],
  ['readdirp', 'readdirp-5.1.1.tgz'],
  ['immutable', 'immutable-5.1.9.tgz'],
  ['source-map-js', 'source-map-js-1.2.1.tgz'],
] as const;
const asyncImporterError = `The canonicalize() function can't return a Promise for synchronous compile functions.
  ╷
1 │ @use 'tokens';
  │ ^^^^^^^^^^^^^
  ╵
  - 1:1  root stylesheet`;

interface DeadlockRun {
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface DeadlockEvidence {
  readonly schema: 1;
  readonly timeoutMs: number;
  readonly attempts: number;
  readonly runs: {
    readonly sass: readonly DeadlockRun[];
    readonly sassEmbedded: readonly DeadlockRun[];
  };
}

const deadlockEvidence = deadlockFixture as DeadlockEvidence;

function nulTerminated(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  return decoder.decode(bytes.subarray(0, nul === -1 ? bytes.byteLength : nul));
}

function packageFiles(tgz: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const tar = gunzipSync(tgz);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = nulTerminated(header.subarray(0, 100));
    const prefix = nulTerminated(header.subarray(345, 500));
    const archivePath = prefix.length === 0 ? name : `${prefix}/${name}`;
    const sizeText = nulTerminated(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || '0', 8);
    const type = header[156];
    const start = offset + 512;
    if ((type === 0 || type === 48) && archivePath.startsWith('package/')) {
      const path = archivePath.slice('package/'.length);
      const parts = path.split('/');
      if (
        path.length === 0 ||
        path.startsWith('/') ||
        path.includes('\\') ||
        parts.some((part) => part === '' || part === '.' || part === '..')
      ) {
        throw new Error(`invalid official package member ${archivePath}`);
      }
      files.set(path, tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

function materializeOfficialPackage(root: string, name: string, fixture: string): void {
  const packageRoot = join(root, 'node_modules', name);
  const bytes = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
  const files = packageFiles(bytes);
  if (!files.has('package.json')) throw new Error(`official ${name} fixture lacks package.json`);
  for (const [path, content] of files) {
    const target = join(packageRoot, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function materializeRecipeCapsule(): {
  readonly container: string;
  readonly packageRoot: string;
  readonly compilerPath: string;
} {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === 'sass-embedded',
  );
  if (!recipe) throw new Error('builtin sass-embedded recipe is missing');

  const container = mkdtempSync(join(tmpdir(), '.rifty-sass-capsule-contract-'));
  try {
    for (const [name, fixture] of oracleTarballs) {
      materializeOfficialPackage(container, name, fixture);
    }
    const packageRoot = join(container, 'node_modules', 'sass-embedded');
    for (const file of recipe.materialization.files) {
      const target = join(packageRoot, ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    const compilerPath = join(container, 'compiler.scss');
    writeFileSync(compilerPath, '$contract: true;\n');
    return { container, packageRoot, compilerPath };
  } catch (error) {
    rmSync(container, { recursive: true, force: true });
    throw error;
  }
}

describe('materialized sass-embedded recipe capsule', () => {
  it('rejects direct construction before entering either pure-Sass constructor', async () => {
    const { container } = materializeRecipeCapsule();
    try {
      const cjsConsumer = join(container, 'constructor-consumer.cjs');
      const esmConsumer = join(container, 'constructor-consumer.mjs');
      writeFileSync(cjsConsumer, '');
      writeFileSync(
        esmConsumer,
        "export * from 'sass-embedded';\nexport {default} from 'sass-embedded';\n",
      );

      type Constructor = new (...args: unknown[]) => unknown;
      const requireFromCapsule = createRequire(cjsConsumer);
      const pureSass = requireFromCapsule(join(container, 'node_modules/sass/sass.node.js')) as {
        Compiler: Constructor;
        AsyncCompiler: Constructor;
      };
      let targetConstructions = 0;
      const observeConstruction = (Constructor: Constructor): Constructor =>
        new Proxy(Constructor, {
          construct(target, args, newTarget) {
            targetConstructions += 1;
            return Reflect.construct(target, args, newTarget);
          },
        });
      pureSass.Compiler = observeConstruction(pureSass.Compiler);
      pureSass.AsyncCompiler = observeConstruction(pureSass.AsyncCompiler);

      const cjs = requireFromCapsule('sass-embedded') as Readonly<Record<string, unknown>>;
      const esm = (await import(pathToFileURL(esmConsumer).href)) as Readonly<
        Record<string, unknown>
      >;
      for (const [moduleKind, namespace] of [
        ['cjs', cjs],
        ['esm', esm],
      ] as const) {
        for (const constructorName of ['Compiler', 'AsyncCompiler'] as const) {
          const Constructor = namespace[constructorName];
          if (typeof Constructor !== 'function') {
            throw new Error(`${moduleKind} ${constructorName} export is not a constructor`);
          }
          let thrown: unknown;
          try {
            Reflect.construct(Constructor, []);
          } catch (error) {
            thrown = error;
          }
          expect(thrown, `${moduleKind} ${constructorName}`).toMatchObject({
            name: 'NotImplementedError',
            message: 'Not implemented: sass-embedded.compiler-construction-liveness',
            feature: 'sass-embedded.compiler-construction-liveness',
          });
        }
      }
      expect(targetConstructions).toBe(0);
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });

  it('matches the committed schema-two embedded oracle beside the exact pure Sass tree', async () => {
    const { container, packageRoot, compilerPath } = materializeRecipeCapsule();
    try {
      const cjsConsumer = join(container, 'consumer.cjs');
      const esmConsumer = join(container, 'consumer.mjs');
      writeFileSync(cjsConsumer, '');
      writeFileSync(
        esmConsumer,
        "export * from 'sass-embedded';\nexport {default} from 'sass-embedded';\n",
      );
      const cjs = createRequire(cjsConsumer)('sass-embedded') as SassContractApi &
        Readonly<Record<string, unknown>>;
      const esm = (await import(pathToFileURL(esmConsumer).href)) as Readonly<
        Record<string, unknown>
      >;
      const stdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      let actual: SassContractTranscript;
      let explicitColorMessage: string;
      let explicitNoColorMessage: string;
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: true,
      });
      try {
        actual = await probeSassContract(
          { cjs, esm } satisfies SassContractModules,
          'sass-embedded@1.100.0',
          {
            compilerPath,
            normalizeCompilerUrl(url): string {
              const value = String(url);
              return value === pathToFileURL(compilerPath).href
                ? 'file:///contract/compiler.scss'
                : value;
            },
          },
        );
        const syntaxErrorMessage = (alertColor: boolean): string => {
          try {
            cjs.compileString('a { color: red;', { alertColor });
          } catch (error) {
            if (error instanceof Error) return error.message;
            throw error;
          }
          throw new Error('Sass color contract expected a syntax error');
        };
        explicitColorMessage = syntaxErrorMessage(true);
        explicitNoColorMessage = syntaxErrorMessage(false);
      } finally {
        if (stdoutIsTty) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTty);
        else Reflect.deleteProperty(process.stdout, 'isTTY');
      }

      expect(actual).toEqual(sassFacadeContract(embeddedFixture as SassContractTranscript));
      const ansiCsi = `${String.fromCharCode(27)}[`;
      expect(explicitColorMessage).toContain(ansiCsi);
      expect(explicitNoColorMessage).not.toContain(ansiCsi);
      const cli = spawnSync(process.execPath, [join(packageRoot, 'dist/bin/sass.js')], {
        encoding: 'utf8',
      });
      expect(cli.error).toBeUndefined();
      expect(cli.status).toBe(1);
      expect(cli.signal).toBeNull();
      expect(cli.stdout).toBe('');
      expect(cli.stderr).toContain('NotImplementedError: Not implemented: sass-embedded.cli');
      const watch = spawnSync(
        process.execPath,
        [join(packageRoot, 'dist/bin/sass.js'), '--watch'],
        { encoding: 'utf8' },
      );
      expect(watch.error).toBeUndefined();
      expect(watch.status).toBe(1);
      expect(watch.signal).toBeNull();
      expect(watch.stdout).toBe('');
      expect(watch.stderr).toContain('NotImplementedError: Not implemented: sass-embedded.watch');
      expect(watch.stderr).not.toContain('sass-embedded.cli');
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });

  it('throws the pure-Sass sync/async-importer error while real embedded times out', () => {
    expect(deadlockEvidence).toMatchObject({ schema: 1, timeoutMs: 2_000, attempts: 2 });
    expect(deadlockEvidence.runs.sass).toHaveLength(deadlockEvidence.attempts);
    for (const run of deadlockEvidence.runs.sass) {
      expect(run).toMatchObject({ timedOut: false, exitCode: 0, signal: null, stderr: '' });
      expect(JSON.parse(run.stdout)).toEqual({
        outcome: 'throw',
        name: 'Error',
        message: asyncImporterError,
        toString: asyncImporterError,
      });
    }
    expect(deadlockEvidence.runs.sassEmbedded).toHaveLength(deadlockEvidence.attempts);
    for (const run of deadlockEvidence.runs.sassEmbedded) {
      expect(run).toEqual({
        timedOut: true,
        exitCode: null,
        signal: 'SIGKILL',
        stdout: '',
        stderr: '',
      });
    }

    const { container } = materializeRecipeCapsule();
    try {
      const cjs = createRequire(join(container, 'consumer.cjs'))(
        'sass-embedded',
      ) as SassContractApi;
      const importer = {
        canonicalize(): Promise<URL> {
          return Promise.resolve(new URL('contract:tokens'));
        },
        load(): Promise<{ readonly contents: string; readonly syntax: 'scss' }> {
          return Promise.resolve({ contents: '$accent: #123456;', syntax: 'scss' });
        },
      };
      let returned = false;
      let thrown: unknown;
      try {
        cjs.compileString("@use 'tokens';", { importers: [importer] });
        returned = true;
      } catch (error) {
        thrown = error;
      }
      expect(returned, 'sync compile must throw before returning control').toBe(false);
      expect(thrown).toBeInstanceOf(Error);
      expect({
        name: (thrown as Error).name,
        message: (thrown as Error).message,
        toString: String(thrown),
      }).toEqual({
        name: 'Error',
        message: asyncImporterError,
        toString: asyncImporterError,
      });
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });
});
