/**
 * exceljs 4.4.0 in a sandbox (unit `backlog/distribution/isolate-host-ceiling-modules-load`,
 * Acceptance 4): its installed closure laid out as `/workspace/node_modules` in the state
 * and in the oracle's temp dir — the same files — each fixture run as `node <file> <out>`
 * on both sides. The modules that load `node:zlib` load as in Node; the streaming writer,
 * which deflates, stops at the named gap.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from '../../runtime-js/src/module-loader/index.ts';
import { closureFiles, inNode, inSandbox } from './package-closure.ts';

const here = dirname(fileURLToPath(import.meta.url));
const closure = closureFiles('exceljs', realpathSync(join(here, '../node_modules/exceljs')));
const withFixture = (gen: string): Map<string, Uint8Array> =>
  new Map(closure)
    .set(gen, readFileSync(join(here, 'fixtures/xlsx', gen)))
    .set('out/.keep', new Uint8Array());

describe('exceljs 4.4.0 loads node:zlib as in Node (Acceptance 4)', () => {
  it(
    'the streaming writer module and crc32-stream (class extends zlib.DeflateRaw) load',
    { timeout: 180_000 },
    async () => {
      const files = withFixture('writer-load.cjs');
      const oracle = inNode(files, 'writer-load.cjs', 'out/none');
      expect(oracle).toMatchObject({
        exitCode: 0,
        stdout: 'function WorkbookWriter DeflateCRC32Stream\ntrue\n',
        stderr: '',
      });
      const guest = await inSandbox(files, 'writer-load.cjs', 'out/none');
      expect(guest).toEqual({ stdout: oracle.stdout, stderr: '', exitCode: 0 });
    },
  );

  // Unit runtime-js/computed-global-read-callee: the closure's `new global[name](…)` sites,
  // on the loader every host shares (in this process). The sandbox cannot reach them yet:
  // is-typed-array's closure first `require`s a `module-sync` ES module (test below).
  it('es-abstract IsDetachedBuffer and typed-array-* construct a computed global as in Node', () => {
    const files = withFixture('typed-arrays-result.cjs').set(
      'typed-arrays.cjs',
      readFileSync(join(here, 'fixtures/xlsx/typed-arrays.cjs')),
    );
    const oracle = inNode(files, 'typed-arrays.cjs', 'out/none');
    expect(oracle).toMatchObject({
      exitCode: 0,
      stdout: '[3,2,6,false,true,[2,3]]\n',
      stderr: '',
    });
    const vfs = new MemoryFsSync();
    for (const [rel, data] of files) {
      vfs.mkdirSync(dirname(`/w/${rel}`), { recursive: true });
      vfs.writeFileSync(`/w/${rel}`, data);
    }
    const result = createModuleLoader(vfs).require('./typed-arrays-result.cjs', '/w/main.cjs');
    expect(`${JSON.stringify(result)}\n`).toBe(oracle.stdout);
  });

  // Past `node:zlib` the main entry stops elsewhere (unit §Decisions, other units). Since
  // runtime-js/computed-global-read-callee it passes es-abstract's `new global[k](…)` and
  // stops at the sandbox's `require` of a `module-sync` ES module (generator-function@2.0.1
  // `require.mjs`): `runtime-js/isolate-require-esm-syntax-gaps`. The PR delivering
  // `require(esm)` in the isolate flips this pin to exceljs's next stop.
  it('require(exceljs) no longer stops at node:zlib', { timeout: 180_000 }, async () => {
    const files = withFixture('main-load.cjs');
    const oracle = inNode(files, 'main-load.cjs', 'out/none');
    expect(oracle).toMatchObject({ exitCode: 0, stdout: 'loaded\n', stderr: '' });
    const guest = await inSandbox(files, 'main-load.cjs', 'out/none');
    expect(guest.exitCode).toBe(1);
    expect(guest.stderr).toMatch(
      /^TypeError: URLConstructor is not a constructor\n {4}at Object\.<anonymous> \(\/workspace\/node_modules\/is-generator-function\/index\.js:12:28\)\n/,
    );
  });

  it(
    'a streaming write deflates: the named gap where Node writes the file',
    { timeout: 180_000 },
    async () => {
      const files = withFixture('stream-write.cjs');
      const out = 'out/stream.xlsx';
      const oracle = inNode(files, 'stream-write.cjs', out);
      expect(oracle, oracle.stderr).toMatchObject({
        exitCode: 0,
        stdout: `wrote ${out}\n`,
        stderr: '',
      });
      expect(oracle.file?.byteLength).toBeGreaterThan(0);
      const guest = await inSandbox(files, 'stream-write.cjs', out);
      expect(guest.exitCode).toBe(1);
      expect(guest.stdout).toBe('');
      expect(guest.stderr).toMatch(
        /^NotImplementedError: Not implemented: isolate-host\.zlib\.DeflateRaw \(no compression engine in the rifty isolate host/,
      );
    },
  );
});
