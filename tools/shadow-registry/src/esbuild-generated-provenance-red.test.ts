import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MANIFEST_PATH = fileURLToPath(
  new URL('../generated/esbuild-runtime-manifest.json', import.meta.url),
);
const OUTPUT_PATH = fileURLToPath(
  new URL('../../../apps/playground/src/workers/generated/esbuild-runtime.js', import.meta.url),
);

const EXPECTED_PATCH_IDS = [
  'inline-worker-startup',
  'node-callback-fs',
  'channel-has-fs',
  'runtime-default-wd',
  'transform-temp-fs',
  'gate-direct-lifecycle',
  'gate-sync-family',
  'gate-analyze-metafile',
  'gate-context-watch-serve',
  'gate-one-shot-build-write',
] as const;

const EXPECTED_METADATA = {
  schema: 1,
  source: {
    package: 'esbuild-wasm',
    version: '0.28.0',
    member: 'package/lib/browser.js',
    sha256: 'b882a5ffb3bf170c0d8f40c0832cc5dca00830400314bb9455dea5d6f58c2a10',
  },
  wasm: {
    member: 'package/esbuild.wasm',
    sha256: '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
  },
  output: {
    path: 'apps/playground/src/workers/generated/esbuild-runtime.js',
    format: 'esm',
  },
} as const;

interface ReadJsonResult {
  readonly value: unknown;
  readonly error: string | null;
}

function readJson(path: string): ReadJsonResult {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown, error: null };
  } catch (error) {
    return { value: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function at(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    const currentRecord = record(current);
    if (currentRecord === null) return undefined;
    current = currentRecord[part];
  }
  return current;
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

const manifest = readJson(MANIFEST_PATH);

describe('generated esbuild runtime provenance Contract+RED', () => {
  it('manifest/present', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it('manifest/exact-source-wasm-output-metadata', () => {
    expect(manifest.error).toBeNull();
    expect({
      schema: at(manifest.value, 'schema'),
      source: at(manifest.value, 'source'),
      wasm: at(manifest.value, 'wasm'),
      output: {
        path: at(manifest.value, 'output', 'path'),
        format: at(manifest.value, 'output', 'format'),
      },
    }).toEqual(EXPECTED_METADATA);
  });

  it('patch-plan/ordered-ids', () => {
    expect(at(manifest.value, 'patches')).toEqual(EXPECTED_PATCH_IDS);
  });

  it('output/present', () => {
    expect(existsSync(OUTPUT_PATH)).toBe(true);
  });

  it('output/integrity-matches-manifest', () => {
    const contents = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : '';
    expect(at(manifest.value, 'output', 'bytes')).toBe(Buffer.byteLength(contents));
    expect(Buffer.byteLength(contents)).toBeGreaterThan(0);
    const declared = at(manifest.value, 'output', 'sha256');
    expect(declared).toMatch(/^[a-f0-9]{64}$/);
    expect(declared).toBe(sha256(contents));
  });
});
