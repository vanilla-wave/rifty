/**
 * pptxgenjs 4.0.1 in a sandbox (unit `backlog/distribution/isolate-host-egress-modules-load`,
 * Acceptance 4): its installed closure is laid out as `/workspace/node_modules` in the state
 * and in the oracle's temp dir — the same files — and each generator runs as
 * `node <file> <out>` on both sides. `fixtures/pptx/pptx.cjs` is the library probe's
 * canonical `gen/pptx.cjs`, byte for byte; no `unhandledRejection` listener, no
 * `process.release` change. Output: every part of the package equal to Node's once
 * the ISO timestamps of `docProps/core.xml` are masked, nested packages (chart data) by part.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ooxmlParts as parts } from './ooxml-parts.ts';
import { closureFiles, inNode, inSandbox } from './package-closure.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PPTXGENJS = realpathSync(join(here, '../node_modules/pptxgenjs'));
// The probe's 1×1 PNG (`gen/pptx.cjs` data URI).
const DOT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const closure = closureFiles('pptxgenjs', PPTXGENJS);

describe('pptxgenjs 4.0.1 writes the same pptx as Node (Acceptance 4)', () => {
  for (const [gen, extra, expectedParts] of [
    ['pptx.cjs', {}, ['ppt/slides/slide3.xml', 'ppt/media/image-1-1.png']],
    [
      'pptx-image-path.cjs',
      { 'dot.png': DOT_PNG },
      ['ppt/slides/slide1.xml', 'ppt/media/image-1-1.png'],
    ],
  ] as const) {
    it(gen, { timeout: 180_000 }, async () => {
      const files = new Map(closure);
      files.set(gen, readFileSync(join(here, 'fixtures/pptx', gen)));
      for (const [rel, data] of Object.entries(extra)) files.set(rel, data);
      files.set('out/.keep', new Uint8Array());
      const out = 'out/deck.pptx';
      const oracle = inNode(files, gen, out);
      expect(oracle, oracle.stderr).toMatchObject({
        exitCode: 0,
        stdout: `wrote ${out}\n`,
        stderr: '',
      });
      const guest = await inSandbox(files, gen, out);
      expect({ stdout: guest.stdout, stderr: guest.stderr, exitCode: guest.exitCode }).toEqual({
        stdout: oracle.stdout,
        stderr: '',
        exitCode: 0,
      });
      const [want, got] = await Promise.all([
        parts(oracle.file ?? new Uint8Array()),
        parts(guest.file ?? new Uint8Array()),
      ]);
      for (const part of ['[Content_Types].xml', 'ppt/presentation.xml', ...expectedParts])
        expect(Object.keys(want)).toContain(part);
      expect(got).toEqual(want);
    });
  }
});
