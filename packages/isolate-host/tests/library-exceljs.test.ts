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
import { describe, expect, it } from 'vitest';
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

  // Past `node:zlib` the main entry stops elsewhere (unit §Decisions, other units): first at
  // `module-loader.cjs-global-function-assignment` (es-abstract `new global[k](…)`).
  it('require(exceljs) no longer stops at node:zlib', { timeout: 180_000 }, async () => {
    const files = withFixture('main-load.cjs');
    const oracle = inNode(files, 'main-load.cjs', 'out/none');
    expect(oracle).toMatchObject({ exitCode: 0, stdout: 'loaded\n', stderr: '' });
    const guest = await inSandbox(files, 'main-load.cjs', 'out/none');
    // Another named gap, not zlib's (and not a crash or a timeout).
    expect(guest.exitCode).toBe(1);
    expect(guest.stderr).toMatch(
      /^NotImplementedError: Not implemented: (?!isolate-host\.zlib)\S+ \(/,
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
