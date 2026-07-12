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

const policy = readJson(fileURLToPath(new URL('../esbuild-runtime-policy.json', import.meta.url)));

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
  validationSource: {
    package: 'esbuild',
    version: '0.28.0',
    member: 'package/lib/main.js',
    sha256: '41abefec8704d24e069532fb38a418905d16f8fee4da88e54ecd65adc71f5507',
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
      validationSource: {
        package: at(manifest.value, 'validationSource', 'package'),
        version: at(manifest.value, 'validationSource', 'version'),
        member: at(manifest.value, 'validationSource', 'member'),
        sha256: at(manifest.value, 'validationSource', 'sha256'),
      },
      output: {
        path: at(manifest.value, 'output', 'path'),
        format: at(manifest.value, 'output', 'format'),
      },
    }).toEqual(EXPECTED_METADATA);
  });

  it('patch-plan/ordered-ids', () => {
    expect(policy.error).toBeNull();
    expect(at(manifest.value, 'patches')).toEqual(at(policy.value, 'patches'));
  });

  it('patch-plan/audits-every-named-hunk-with-spans-and-hashes', () => {
    const hunks = at(manifest.value, 'hunks');
    expect(Array.isArray(hunks)).toBe(true);
    expect((hunks as readonly unknown[]).length).toBeGreaterThan(
      (at(manifest.value, 'patches') as readonly unknown[]).length,
    );
    for (const value of hunks as readonly unknown[]) {
      const hunk = record(value);
      expect(hunk?.id).toEqual(expect.any(String));
      expect(hunk?.hunk).toEqual(expect.any(String));
      expect(hunk?.beforeSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(hunk?.afterSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(record(hunk?.inputSpan)).toEqual({
        start: expect.any(Number),
        end: expect.any(Number),
      });
      expect(record(hunk?.outputSpan)).toEqual({
        start: expect.any(Number),
        end: expect.any(Number),
      });
    }
  });

  it('validation-source/pins-oracle-anchors-and-content-hashes', () => {
    expect(at(manifest.value, 'validationSource', 'anchors')).toEqual([
      {
        id: 'sync-build-validation',
        inputSpan: { start: expect.any(Number), end: expect.any(Number) },
        sha256: '2998e2821ef1f87f4782c9fc51003b5d4bf7f6e4df52a43947e3ee18608268a2',
      },
      {
        id: 'sync-analyze-validation',
        inputSpan: { start: expect.any(Number), end: expect.any(Number) },
        sha256: '9eb837dd43da594cf02a89dd70e73ef7bbeab389b9ab6e685291d2d1e6a27562',
      },
      {
        id: 'native-validation-must-be',
        inputSpan: { start: expect.any(Number), end: expect.any(Number) },
        sha256: 'e680a38380dde2da37250cc2f05234766528e62967429cf9e2beafd48f738450',
        location: {
          file: '/node_modules/esbuild/lib/main.js',
          namespace: 'file',
          line: 534,
          column: 29,
          length: 0,
          lineText: '  if (mustBe !== null) throw new Error(`${quote(key)} must be ${mustBe}`);',
          suggestion: '',
        },
      },
      {
        id: 'native-validation-invalid-option',
        inputSpan: { start: expect.any(Number), end: expect.any(Number) },
        sha256: '7c991bb02b494ef1061fd3327ee68bbd00802b44468cb56d072cf704eb114eca',
        location: {
          file: '/node_modules/esbuild/lib/main.js',
          namespace: 'file',
          line: 540,
          column: 12,
          length: 0,
          lineText: '      throw new Error(`Invalid option ${where}: ${quote(key)}`);',
          suggestion: '',
        },
      },
    ]);
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

  it('output/exports-the-exact-upstream-outer-object-with-private-startup', () => {
    const contents = readFileSync(OUTPUT_PATH, 'utf8');
    expect(contents.match(/module\.exports = __toCommonJS\(browser_exports\);/g)).toHaveLength(1);
    expect(contents).toContain('const esbuild = module.exports;');
    expect(contents).toContain('export default esbuild;');
    expect(contents).toContain('export { startEsbuildRuntime };');
    expect(contents).toContain('startEsbuildRuntime = ({ wasm, fs, cwd }) => {');
    expect(contents.match(/startRunningService\("", wasm, false\)/g)).toHaveLength(1);
    expect(contents).toContain(
      'import { createEsbuildCallbackFs } from "../esbuild-runtime-fs.ts";',
    );
    expect(contents).toContain('globalThis.fs = runtimeFs.go;');
    expect(contents).toContain('        fs: runtimeFs.transform,');
    expect(contents).toContain('var validationErrorOrigins = new WeakMap();');
    expect(contents).toContain('validationErrorOrigins.set(error, origin);');
    expect(contents).toContain('normalizeTargetErrnoMessage(message);');
    expect(contents).not.toContain('error.stack');
    expect(contents).not.toContain('new Proxy(');
    expect(contents).not.toContain('structuredClone(');
  });

  it('output/validates-before-each-named-capability-gap', () => {
    const contents = readFileSync(OUTPUT_PATH, 'utf8');
    expect(contents).toContain(
      'options = validateInitializeOptions(options || {});\n' +
        '  if (options.wasmURL) throw new Error',
    );
    expect(contents).toContain(
      'checkForInvalidFlags(options, keys, `in ${callName}() call`);\n' +
        '    if (metafile == null) Object.keys(metafile);\n' +
        '    throw new NotImplementedError("esbuild.analyzeMetafile");',
    );
    expect(contents).toContain(
      'checkForInvalidFlags(options2, keys, `in watch() call`);\n' +
        '          throw new NotImplementedError("esbuild.context.watch");',
    );
    expect(contents).toContain(
      'checkForInvalidFlags(options2, keys, `in serve() call`);\n' +
        '          throw new NotImplementedError("esbuild.context.serve");',
    );
  });
});
