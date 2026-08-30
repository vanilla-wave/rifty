/**
 * Fixture-provenance pins (GREEN + detection): "esbuild of the REAL prod
 * sources" must be a structured record, never a narration — a byte-identical
 * source COPY under `tests/` builds byte-identical bundles and passes every
 * output row. The metafile written by `build-fixtures.mjs` at global-setup
 * records the entryPoint esbuild ACTUALLY consumed per bundle; this spec pins
 * the exact expected mapping (all four bundles, literal `packages/` paths)
 * and that `assertFixtureProvenance` REJECTS copy-path / missing-output /
 * unconsumed-entry mutants with exact messages.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { FIXTURE_ENTRYPOINTS, assertFixtureProvenance } from './build-fixtures.mjs';

const metafilePath = fileURLToPath(new URL('./fixtures/dist/metafile.json', import.meta.url));

interface Metafile {
  outputs: Record<string, { entryPoint?: string; inputs?: Record<string, unknown> }>;
}

function loadMetafile(): Metafile {
  return JSON.parse(readFileSync(metafilePath, 'utf8')) as Metafile;
}

test('declared entrypoints are EXACTLY the four prod sources (literal packages/ paths — a fixture-copy re-route must edit this pin)', () => {
  expect(FIXTURE_ENTRYPOINTS).toEqual({
    'worker-realm-compat.mjs': 'packages/runtime-js/src/ipc/worker-realm-compat.ts',
    'util-types.mjs': 'packages/runtime-js/src/builtins/util-types.ts',
    'kernel-public.mjs': 'packages/kernel/src/index.ts',
    'kernel-stdio-drain.mjs': 'packages/kernel/src/worker-stdio-drain.ts',
  });
});

test('built metafile records every bundle as built from its declared prod entry (green provenance)', () => {
  const metafile = loadMetafile();
  assertFixtureProvenance(metafile);
  for (const [out, entry] of Object.entries(FIXTURE_ENTRYPOINTS)) {
    const record = metafile.outputs[`tests/no-coi/fixtures/dist/${out}`];
    expect(record?.entryPoint, out).toBe(entry);
    expect(record?.inputs?.[entry], `${out} consumed ${entry}`).toBeDefined();
  }
});

test('provenance detection: copy-path entryPoint, missing output, and unconsumed entry each throw the exact message', () => {
  const key = 'tests/no-coi/fixtures/dist/util-types.mjs';
  const entry = 'packages/runtime-js/src/builtins/util-types.ts';

  // Byte-identical source copy: same output bytes, different consumed path.
  const copyPath = 'tests/no-coi/fixtures/src/util-types.ts';
  const copied = loadMetafile();
  copied.outputs[key] = { entryPoint: copyPath, inputs: { [copyPath]: {} } };
  expect(() => assertFixtureProvenance(copied)).toThrowError(
    `fixture provenance: ${key} built from ${copyPath}, expected ${entry}`,
  );

  const missing = loadMetafile();
  delete missing.outputs[key];
  expect(() => assertFixtureProvenance(missing)).toThrowError(
    `fixture provenance: no metafile output for ${key}`,
  );

  const unconsumed = loadMetafile();
  unconsumed.outputs[key] = { entryPoint: entry, inputs: {} };
  expect(() => assertFixtureProvenance(unconsumed)).toThrowError(
    `fixture provenance: ${key} never consumed its entry source ${entry}`,
  );
});
