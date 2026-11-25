/**
 * ADR-0573 build inputs: a download whose sha256 is not the pin in generated/sources.json is refused
 * before anything unpacks or runs it, and dropped from the cache (no network: the corrupt file is
 * already cached under the pinned name).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const GEN = 'tools/publishing/generate-zlib-wasm.mjs';
const pins = JSON.parse(
  readFileSync('packages/runtime-js/src/zlib-engine/generated/sources.json', 'utf8'),
) as { toolchain: { hosts: Record<string, { url: string; sha256: string }> } };
const cache = mkdtempSync(join(tmpdir(), 'zlib-wasm-cache-'));
afterAll(() => rmSync(cache, { recursive: true, force: true }));

describe('generate-zlib-wasm.mjs pinned downloads', () => {
  const pin = pins.toolchain.hosts[`${process.platform}-${process.arch}`];
  it.skipIf(!pin)(
    'a cached toolchain tarball with the wrong bytes fails loudly and is removed',
    () => {
      const p = pin as { url: string; sha256: string };
      const file = join(cache, 'dl', `${p.sha256}-${p.url.slice(p.url.lastIndexOf('/') + 1)}`);
      mkdirSync(join(cache, 'dl'), { recursive: true });
      writeFileSync(file, 'not a toolchain');
      const r = spawnSync(process.execPath, [GEN, '--rebuild', '--cache', cache], {
        encoding: 'utf8',
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(new RegExp(`sha256 [0-9a-f]{64}, pinned ${p.sha256}`));
      expect(existsSync(file)).toBe(false);
      expect(existsSync(join(cache, 'x'))).toBe(false);
    },
  );
});
