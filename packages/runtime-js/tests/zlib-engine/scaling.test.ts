/**
 * Copying is linear: each input byte (and each dictionary, once per stream) enters the engine's
 * memory once and each output byte leaves it once, whatever the number of handle calls — under Node's
 * own lib/zlib.js (copy-count.mjs, its own Node process for `--expose-internals`): sync, callback,
 * stream, 2-member gunzip, `chunkSize` 1 MiB × 4000 writes, a dictionary, `params()` mid-stream with
 * a flush per write, deflate. The guard counts bytes, not milliseconds: under test:run's load the time
 * ratios of a linear and a quadratic handle overlapped.
 */
// The child process loads these; imported here so `vitest --changed` relates this test to them.
import '../../src/zlib-engine/engine';
import '../../src/zlib-engine/handle';
import '../../src/zlib-engine/wasm-bytes';
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
    expect(rows.length).toBe(8);
    expect(rows.map((r) => [r.name, r.copiedIn - r.input, r.copiedOut - r.output])).toEqual(
      rows.map((r) => [r.name, 0, 0]),
    );
  });
});
