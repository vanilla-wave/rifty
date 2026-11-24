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
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { closureFiles, inNode, inSandbox } from './package-closure.ts';

const here = dirname(fileURLToPath(import.meta.url));
const closure = closureFiles('exceljs', realpathSync(join(here, '../node_modules/exceljs')));
/** The loader every host shares, in this process, over `files` under `/w`. */
function sharedLoader(files: Map<string, Uint8Array>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  for (const [rel, data] of files) {
    vfs.mkdirSync(dirname(`/w/${rel}`), { recursive: true });
    vfs.writeFileSync(`/w/${rel}`, data);
  }
  return createModuleLoader(vfs);
}
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
    const result = sharedLoader(files).require('./typed-arrays-result.cjs', '/w/main.cjs');
    expect(`${JSON.stringify(result)}\n`).toBe(oracle.stdout);
  });

  it('require(exceljs) loads on the shared loader as in Node', { timeout: 60_000 }, () => {
    const files = withFixture('main-load.cjs');
    const oracle = inNode(files, 'main-load.cjs', 'out/none');
    expect(oracle).toMatchObject({ exitCode: 0, stdout: 'loaded\n', stderr: '' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      sharedLoader(files).require('./main-load.cjs', '/w/main.cjs');
      expect(log.mock.calls).toEqual([['loaded']]);
    } finally {
      log.mockRestore();
    }
  });

  // Past `node:zlib` the main entry stops elsewhere (unit §Decisions, other units); since
  // runtime-js/computed-global-read-callee not at es-abstract's `new global[k](…)`.
  it('require(exceljs) no longer stops at node:zlib', { timeout: 180_000 }, async () => {
    const files = withFixture('main-load.cjs');
    const oracle = inNode(files, 'main-load.cjs', 'out/none');
    expect(oracle).toMatchObject({ exitCode: 0, stdout: 'loaded\n', stderr: '' });
    const guest = await inSandbox(files, 'main-load.cjs', 'out/none');
    // The run ended (no timeout), with no loader ceiling and not at zlib's gap.
    expect(guest.exitCode).not.toBeNull();
    expect(guest.stderr).not.toMatch(/module-loader\.\w+|isolate-host\.zlib/);
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
