import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('esbuild-wasm/package.json');
const packageRoot = dirname(packagePath);

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('esbuild-wasm 0.28.0 Contract+RED source pin', () => {
  it('pins the exact upstream browser CJS client and Go WASM bytes from ADR-0226', () => {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      readonly version?: unknown;
    };
    expect(manifest.version).toBe('0.28.0');
    expect(sha256(join(packageRoot, 'lib/browser.js'))).toBe(
      'b882a5ffb3bf170c0d8f40c0832cc5dca00830400314bb9455dea5d6f58c2a10',
    );
    expect(sha256(join(packageRoot, 'esbuild.wasm'))).toBe(
      '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
    );
  });
});
