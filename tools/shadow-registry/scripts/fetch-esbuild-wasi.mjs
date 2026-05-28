#!/usr/bin/env node
/**
 * Build-time vendoring of esbuild's real WASI-preview1 binary.
 *
 * Pulls `@esbuild/wasi-preview1` from the npm registry, verifies the tarball
 * against a pinned SHA-512 integrity, extracts `esbuild.wasm`, and drops it at
 * `tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm`.
 *
 * Per CLAUDE.md ("bias toward build-time scripts over runtime deps", ADR-0047),
 * this is NOT a package dependency — the wasm artifact is vendored once and
 * checked in. Re-run this script to refresh it after bumping PINNED_VERSION.
 *
 * Zero non-builtin deps: `node:https` for the fetch, `node:crypto` for the
 * integrity check, `node:zlib` for gunzip, and a minimal POSIX-ustar reader
 * for the single file we need. We deliberately avoid pulling `tar`/`pacote`.
 *
 * Why this package and not `esbuild-wasm`: `esbuild-wasm` ships Go's `js/wasm`
 * (`gojs`) ABI and cannot run on a WASI-preview1 host. `@esbuild/wasi-preview1`
 * is a genuine `wasi_snapshot_preview1` binary (zero deps, ~20 MB wasm). See
 * ADR-0047, which supersedes ADR-0044 D1/D2.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const PINNED_VERSION = '0.28.0';
// dist.integrity from the registry manifest for @esbuild/wasi-preview1@0.28.0.
// If this mismatches, the registry served something other than what we pinned
// and the script aborts rather than vendoring an unverified binary.
const PINNED_INTEGRITY =
  'sha512-6Mm1hljxx5NJgqnZupvOLfGGKW+9icZUottY+D1a7+QmddYogj84mAFfgZiobQG4qMbW9tIQubV0lL9XGFKLiw==';
const TARBALL_URL = `https://registry.npmjs.org/@esbuild/wasi-preview1/-/wasi-preview1-${PINNED_VERSION}.tgz`;
const WASM_ENTRY = 'esbuild.wasm';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'vendor', 'esbuild-wasi-preview1');
const OUT_WASM = join(OUT_DIR, WASM_ENTRY);

/** Fetch a URL into a Buffer, following one level of redirect. */
function fetchBuffer(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirects <= 0) {
          reject(new Error(`too many redirects fetching ${url}`));
          return;
        }
        res.resume();
        fetchBuffer(res.headers.location, redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        reject(new Error(`GET ${url} → HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Subresource-Integrity style check: `sha512-<base64>`. */
function verifyIntegrity(buf, integrity) {
  const [algo, expected] = integrity.split('-', 2);
  const actual = createHash(algo).update(buf).digest('base64');
  if (actual !== expected) {
    throw new Error(
      `integrity mismatch for ${TARBALL_URL}\n  expected ${algo}-${expected}\n  actual   ${algo}-${actual}`,
    );
  }
}

/**
 * Minimal POSIX-ustar tar reader. Returns the bytes of the first entry whose
 * basename equals `wanted`. Handles the GNU/PAX `././@LongLink` and PAX
 * extended-header records by skipping them (npm tarballs use short names under
 * `package/`, so we never actually need long-name reconstruction here).
 */
function extractFromTar(tarBuf, wanted) {
  const BLOCK = 512;
  let offset = 0;
  while (offset + BLOCK <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark end-of-archive.
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeField, 8) || 0;
    const typeflag = String.fromCharCode(header[156]);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    const base = name.split('/').pop();
    // Regular file ('0' or '\0') with the basename we want.
    if ((typeflag === '0' || typeflag === '\0' || typeflag === '') && base === wanted) {
      return tarBuf.subarray(dataStart, dataEnd);
    }
    // Advance past this entry's data, rounded up to the next 512-byte block.
    offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  return null;
}

async function main() {
  process.stdout.write(`Fetching ${TARBALL_URL}\n`);
  const tgz = await fetchBuffer(TARBALL_URL);
  verifyIntegrity(tgz, PINNED_INTEGRITY);
  process.stdout.write(`Integrity OK (${PINNED_INTEGRITY.slice(0, 16)}…)\n`);

  const tar = gunzipSync(tgz);
  const wasm = extractFromTar(tar, WASM_ENTRY);
  if (!wasm) throw new Error(`${WASM_ENTRY} not found in tarball`);

  // Sanity: a real wasm module starts with the magic "\0asm".
  if (!(wasm[0] === 0x00 && wasm[1] === 0x61 && wasm[2] === 0x73 && wasm[3] === 0x6d)) {
    throw new Error(`${WASM_ENTRY} is not a WebAssembly module (bad magic)`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_WASM, wasm);
  process.stdout.write(`Wrote ${OUT_WASM} (${(wasm.length / 1024 / 1024).toFixed(1)} MB)\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
