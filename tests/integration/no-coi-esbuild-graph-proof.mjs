import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Inspect the actual packed toolchain outputs, including lazy execution chunks. */
export async function proveNoCoiEsbuildGraph(root) {
  const meta = JSON.parse(await readFile(resolve(root, 'measure/toolchain/metafile.json'), 'utf8'));
  for (const output of Object.keys(meta.outputs).filter((path) => path.endsWith('.js'))) {
    const code = await readFile(resolve(root, output), 'utf8');
    assert(
      !code.includes('startEsbuildRuntime'),
      `no-COI graph retains generated esbuild client: ${output}`,
    );
  }
}
