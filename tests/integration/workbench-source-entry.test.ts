import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('keeps the real no-COI entry when a workspace worker wrapper imports it for side effects', async () => {
  const result = await build({
    stdin: {
      contents: "import '@riftydev/workbench/no-coi-toolchain-worker';",
      resolveDir: resolve('apps/playground'),
    },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    outdir: '/tmp/rifty-workbench-source-entry',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const entry = Object.values(result.metafile.outputs).find(
    (output) => output.entryPoint === '<stdin>',
  );
  expect(entry?.bytes).toBeGreaterThan(0);
  expect(
    Object.values(result.metafile.outputs).some(
      (output) =>
        (output.inputs['packages/workbench/src/workers/no-coi-toolchain-worker.ts']
          ?.bytesInOutput ?? 0) > 0,
    ),
  ).toBe(true);
});
