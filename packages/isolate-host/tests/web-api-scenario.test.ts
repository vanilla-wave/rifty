/**
 * Goal isolate-guest-web-api carrier (`docs/backlog/epics/isolate-guest-web-api/`, map item 1):
 * scenario steps 1–2 in the sandbox (`exec`) over the library's installed closure, oracle live
 * `node <step>` over the same files. The output package is compared by part (`ooxml-parts.ts`).
 * Step 3 (pdfkit) is `zlib-scenario.test.ts` case 4. Both steps were pinned at their whole outcome
 * (`Pin`/`pinOf`, PR #453) until unit 2 (ADR-0578, PR #458) made them Node's.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ooxmlParts } from './ooxml-parts.ts';
import { type Outcome, closureFiles, inNode, inSandbox } from './package-closure.ts';
import { type Pin, pinOf } from './zlib-scenario.ts';

const here = dirname(fileURLToPath(import.meta.url));
const installed = (name: string, version: string): string => {
  const dir = realpathSync(join(here, '../node_modules', name));
  const found = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string })
    .version;
  if (found !== version) throw new Error(`${name}@${found} installed, goal names ${version}`);
  return dir;
};

interface Step {
  readonly program: string;
  readonly pkg: string;
  readonly version: string;
  readonly output: string;
  /** A part the package must hold (it is not an empty package). */
  readonly part: string;
}
const STEPS: readonly Step[] = [
  {
    program: 'pptx-write.cjs',
    pkg: 'pptxgenjs',
    version: '4.0.1',
    output: 'deck.pptx',
    part: 'ppt/slides/slide1.xml',
  },
  {
    program: 'docx-toblob.cjs',
    pkg: 'docx',
    version: '9.15.3',
    output: 'report.docx',
    part: 'word/document.xml',
  },
];

/** A run as compared: the output package's parts as JSON (null: not written). */
async function observed(run: Outcome): Promise<Pin> {
  return pinOf({
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    output: run.file === undefined ? null : JSON.stringify(await ooxmlParts(run.file)),
  });
}

describe('isolate-guest-web-api scenario vs Node (isolate host)', () => {
  for (const step of STEPS) {
    it(
      `${step.program}: ${step.pkg} ${step.version} → ${step.output} equals Node`,
      { timeout: 180_000 },
      async () => {
        const files = closureFiles(step.pkg, installed(step.pkg, step.version));
        files.set(step.program, readFileSync(join(here, 'fixtures/web-api', step.program)));
        const node = await observed(inNode(files, step.program, step.output));
        expect(node, node.stderr).toMatchObject({
          exitCode: 0,
          stderr: '',
          stdout: expect.stringContaining('bytes true'),
        });
        expect(Object.keys(JSON.parse(node.output ?? '{}'))).toContain(step.part);
        expect(await observed(await inSandbox(files, step.program, step.output))).toEqual(node);
      },
    );
  }
});
