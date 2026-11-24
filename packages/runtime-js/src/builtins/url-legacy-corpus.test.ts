/**
 * ADR-0574 Acceptance 2/5, runtime-js lane with a global `URL` (the code every browser host
 * ships; here Node's `URL` stands in): Node v24.16.0's own url/querystring test calls
 * (`tests/fixtures/url-legacy`) replayed by the guest through rifty's loader give the record
 * live Node gives for the same file — own keys in order, values, prototype, thrown name/code/message.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from '../module-loader/index.ts';

const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/url-legacy/', import.meta.url));
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

function oracle(corpus: string): unknown[] {
  expect(process.version).toBe('v24.16.0');
  const dir = mkdtempSync(join(tmpdir(), 'url-legacy-oracle-'));
  try {
    const out = join(dir, 'out.json');
    const r = spawnSync(
      process.execPath,
      [join(FIXTURES, 'program.cjs'), join(FIXTURES, corpus), out],
      {
        encoding: 'utf8',
      },
    );
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(readFileSync(out, 'utf8')) as unknown[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function rifty(corpus: string): unknown[] {
  const vfs = new MemoryFsSync();
  vfs.mkdirSync('/w', { recursive: true });
  for (const name of ['codec.cjs', 'replay.cjs'])
    vfs.writeFileSync(`/w/${name}`, new TextEncoder().encode(read(name)));
  const replay = createModuleLoader(vfs).require('/w/replay.cjs') as {
    replayCorpus(corpus: unknown): unknown[];
  };
  return JSON.parse(JSON.stringify(replay.replayCorpus(JSON.parse(read(corpus))))) as unknown[];
}

function differing(expected: unknown[], actual: unknown[]): number[] {
  expect(actual.length).toBe(expected.length);
  return expected.flatMap((record, index) =>
    JSON.stringify(record) === JSON.stringify(actual[index]) ? [] : [index],
  );
}

describe('legacy node:url and node:querystring equal Node on its own test calls', () => {
  it('url: parse/format/resolve/resolveObject (1 314 calls)', () => {
    const expected = oracle('url-calls.json');
    const actual = rifty('url-calls.json');
    const diff = differing(expected, actual);
    expect(
      diff.slice(0, 5).map((i) => ({ i, node: expected[i], rifty: actual[i] })),
      `${diff.length} differ`,
    ).toEqual([]);
  });

  it('querystring: parse/stringify/escape/unescape/unescapeBuffer and options', () => {
    const expected = oracle('querystring-calls.json');
    const actual = rifty('querystring-calls.json');
    const diff = differing(expected, actual);
    expect(
      diff.slice(0, 5).map((i) => ({ i, node: expected[i], rifty: actual[i] })),
      `${diff.length} differ`,
    ).toEqual([]);
  });
});
