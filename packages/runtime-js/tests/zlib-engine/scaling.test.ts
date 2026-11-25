/**
 * Copying is linear: each input byte enters the engine's memory once and each output byte leaves
 * it once, whatever the number of handle calls — under Node's own lib/zlib.js (copy-count.mjs, its
 * own Node process for `--expose-internals`), sync, callback and stream forms. A per-call copy of
 * the remaining input (round 1: 64 MiB raw inflate 3110 ms vs Node's 10 ms) or of the whole out
 * window (a 1 MiB `chunkSize` per write) shows as copied bytes over the input/output sizes. Bytes,
 * not milliseconds: under test:run's load the time ratios of linear and quadratic overlapped.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./copy-count.mjs', import.meta.url));

describe('zlib-engine copies input and output once, under lib/zlib.js', () => {
  it('copied in = input, copied out = output, per scenario', { timeout: 120_000 }, () => {
    const rows = JSON.parse(
      execFileSync(process.execPath, ['--expose-internals', '--import', 'tsx', SCRIPT], {
        encoding: 'utf8',
        maxBuffer: 16 << 20,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as { name: string; input: number; output: number; copiedIn: number; copiedOut: number }[];
    expect(rows.length).toBe(6);
    expect(rows.map((r) => [r.name, r.copiedIn - r.input, r.copiedOut - r.output])).toEqual(
      rows.map((r) => [r.name, 0, 0]),
    );
  });
});
