/**
 * Unit 2 Acceptance 2 (ADR-0573), suite half: Node v24.16.0's own deflate-family
 * `test/parallel/test-zlib*.js` (47; brotli/zstd out of scope), each in its own Node process with
 * `binding.Zlib` and `binding.crc32` swapped for the product's (swap-binding.cjs), under Node's own
 * lib/zlib.js and `stream.Transform`. Every file passes; the files that write through a handle are
 * counted, not assumed (36 write; `test-zlib-crc32.js` calls the product's crc32).
 */
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { NODE_FIXTURES } from './harness';

const TSX_CJS = createRequire(import.meta.url).resolve('tsx/cjs');
const SWAP = fileURLToPath(new URL('./swap-binding.cjs', import.meta.url));
// Outside the repo: runtime-js's `"type": "module"` would make Node's CJS tests ESM, and their
// test/.tmp.N dirs stay out of the tree.
const root = mkdtempSync(join(tmpdir(), 'zlib-engine-suite-'));
cpSync(join(NODE_FIXTURES, 'test'), join(root, 'test'), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));
const dir = join(root, 'test/parallel');
const files = readdirSync(dir)
  .filter((f) => /^test-zlib.*\.js$/.test(f))
  .sort();

/** Files that never write through a handle (they pass either way; pinned so a lost write shows). */
const NO_WRITE = [
  'test-zlib-const.js',
  'test-zlib-crc32.js',
  'test-zlib-create-raw.js',
  'test-zlib-deflate-constructors.js',
  'test-zlib-failed-init.js',
  'test-zlib-flush-flags.js',
  'test-zlib-maxOutputLength.js', // brotli only
  'test-zlib-not-string-or-buffer.js',
  'test-zlib-object-write.js',
  'test-zlib-unused-weak.js',
  'test-zlib-zero-windowBits.js',
];

let serial = 0;
function run(
  file: string,
): Promise<{ file: string; ok: boolean; why: string; writes: number; crcs: number }> {
  const src = readFileSync(join(dir, file), 'utf8');
  const flags = (src.match(/^\/\/ Flags: (.*)$/m)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const id = ++serial;
  const trace = join(root, `writes.${id}`);
  const env = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    TEST_SERIAL_ID: String(id), // own test/.tmp.N per file
    ZLIB_ENGINE_TRACE: trace,
  };
  return new Promise((res) => {
    execFile(
      process.execPath,
      [...flags, '--require', TSX_CJS, '-r', SWAP, join(dir, file)],
      { cwd: root, env, timeout: 180_000, maxBuffer: 64 << 20 },
      (err, _out, stderr) => {
        let writes = 0;
        let crcs = 0;
        try {
          for (const line of readFileSync(trace, 'utf8').split('\n').filter(Boolean)) {
            const [w, c] = line.split(' ').map(Number);
            writes += w ?? 0;
            crcs += c ?? 0;
          }
        } catch {}
        const why = err
          ? (stderr.split('\n').find((l) => /Error|assert|not ok/.test(l)) ?? `exit ${err.code}`)
          : '';
        res({ file, ok: !err, why: why.trim().slice(0, 200), writes, crcs });
      },
    );
  });
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k] as T);
      }
    }),
  );
  return out;
}

describe("Node v24.16.0's deflate-family test-zlib*.js over the product handle", () => {
  it('every file passes; 36 of the 47 write through the handle', { timeout: 600_000 }, async () => {
    expect(files.length).toBe(47);
    const results = await pool(files, 8, run);
    expect(results.filter((r) => !r.ok).map((r) => `${r.file}: ${r.why}`)).toEqual([]);
    expect(results.filter((r) => r.writes === 0).map((r) => r.file)).toEqual(NO_WRITE);
    expect(results.filter((r) => r.writes > 0).length).toBe(36);
    // test-zlib-crc32.js goes through lib/zlib.js's binding.crc32: the product's.
    expect(results.find((r) => r.file === 'test-zlib-crc32.js')?.crcs).toBeGreaterThan(0);
  });
});
