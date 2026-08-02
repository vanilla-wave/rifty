import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import embeddedFixture from './fixtures/sass-embedded-1.100.0-contract.json';
import { builtinShadowSubstitutionCatalog } from './internal/index.ts';
import {
  type SassContractApi,
  type SassContractModules,
  type SassContractTranscript,
  probeSassContract,
} from './test-sass-contract-probe.ts';

const decoder = new TextDecoder();
const oracleTarballs = [
  ['sass', 'sass-1.100.0.tgz'],
  ['chokidar', 'chokidar-5.0.0.tgz'],
  ['readdirp', 'readdirp-5.0.0.tgz'],
  ['immutable', 'immutable-5.1.9.tgz'],
  ['source-map-js', 'source-map-js-1.2.1.tgz'],
] as const;

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

describe('materialized sass-embedded recipe capsule', () => {
  it('matches the committed nine-row embedded oracle beside the exact pure Sass tree', async () => {
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
      const actual = await probeSassContract(
        { cjs, esm } satisfies SassContractModules,
        'sass-embedded@1.100.0',
      );

      expect(actual).toEqual(embeddedFixture as SassContractTranscript);
      const cli = spawnSync(process.execPath, [join(packageRoot, 'dist/bin/sass.js')], {
        encoding: 'utf8',
      });
      expect(cli.error).toBeUndefined();
      expect(cli.status).toBe(1);
      expect(cli.signal).toBeNull();
      expect(cli.stdout).toBe('');
      expect(cli.stderr).toContain('NotImplementedError: Not implemented: sass-embedded.cli');
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });
});
