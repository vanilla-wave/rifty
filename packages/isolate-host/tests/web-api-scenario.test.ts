/**
 * Goal isolate-guest-web-api carrier (`docs/backlog/distribution/isolate-guest-web-api-acceptance.md`):
 * scenario steps 1–2 in the sandbox (`exec`) over the library's installed closure, oracle live
 * `node <step>` over the same files. The output package is compared by part (`ooxml-parts.ts`).
 * Step 3 (pdfkit) is `zlib-scenario.test.ts` case 4. Today's whole outcome is pinned per step
 * (`Pin`/`pinOf`, PR #453); the unit that delivers a step replaces its pin with equality to Node.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ooxmlParts } from './ooxml-parts.ts';
import { type Outcome, closureFiles, inNode, inSandbox } from './package-closure.ts';
import { type Mask, type Pin, pinOf } from './zlib-scenario.ts';

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
}
const STEPS: readonly Step[] = [
  { program: 'pptx-write.cjs', pkg: 'pptxgenjs', version: '4.0.1', output: 'deck.pptx' },
  { program: 'docx-toblob.cjs', pkg: 'docx', version: '9.15.3', output: 'report.docx' },
];

/** The isolate's stderr masks; nothing else of it is rewritten. */
const MASKS: readonly Mask[] = [
  {
    why: "the line and column of a frame in rifty's own guest bundle, which moves with any bundle change; the file stays",
    pattern: /(?<=rifty-isolate-guest\.js):\d+:\d+/g,
    to: ':<line>',
  },
];

/** A run as compared: the output package's parts as JSON (null: not written). */
async function observed(run: Outcome, masks: readonly Mask[] = []): Promise<Pin> {
  return pinOf(
    {
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      output: run.file === undefined ? null : JSON.stringify(await ooxmlParts(run.file)),
    },
    masks,
  );
}

/** Measured on main 3d16cb7b8: the whole outcome, no mask (the isolate's paths are `/workspace/…`). */
const PINS: Readonly<Record<string, Pin>> = {
  // JSZip's load-time `support.blob` probe failed (no `Blob`); `write()` asks for a blob.
  'pptx-write.cjs': {
    exitCode: 1,
    stdout: '',
    stderr: `Error: blob is not supported by this platform
    at exports.checkSupport (/workspace/node_modules/jszip/lib/utils.js:378:15)
    at JSZip.generateInternalStream (/workspace/node_modules/jszip/lib/object.js:342:19)
    at JSZip.generateAsync (/workspace/node_modules/jszip/lib/object.js:370:21)
    at PptxGenJS.eval (/workspace/node_modules/pptxgenjs/dist/pptxgen.cjs.js:7082:42)
    at Generator.next (<anonymous>)
    at eval (/workspace/node_modules/pptxgenjs/dist/pptxgen.cjs.js:29:71)
    at new Promise (<anonymous>)
    at __awaiter (/workspace/node_modules/pptxgenjs/dist/pptxgen.cjs.js:25:12)
    at eval (/workspace/node_modules/pptxgenjs/dist/pptxgen.cjs.js:7071:71)
    at wrapF (rifty-isolate-guest.js:<line>)
`,
    output: null,
  },
  'docx-toblob.cjs': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.Blob (not available in the rifty isolate host, ADR-0557)
    at notImplemented (rifty-isolate-guest.js:<line>)
    at new Blob (rifty-isolate-guest.js:<line>)
    at blob (/workspace/node_modules/docx/dist/index.cjs:23940:10)
    at zipOutput (/workspace/node_modules/docx/dist/index.cjs:23959:9)
    at Packer.eval (/workspace/node_modules/docx/dist/index.cjs:26926:11)
    at Generator.next (<anonymous>)
    at asyncGeneratorStep (/workspace/node_modules/docx/dist/index.cjs:26849:15)
    at _next (/workspace/node_modules/docx/dist/index.cjs:26862:5)
    at eval (/workspace/node_modules/docx/dist/index.cjs:26867:4)
    at new Promise (<anonymous>)
`,
    output: null,
  },
};
/** Per step, when it stops being a pin (map units 2, 3). */
const GREEN = 'expected green after unit 2 (runtime-js/isolate-guest-blob-file)';

describe('isolate-guest-web-api scenario vs Node (isolate host)', () => {
  for (const step of STEPS) {
    it(
      `${step.program}: ${step.pkg} ${step.version} → ${step.output} — today pinned; ${GREEN}`,
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
        const rifty = await observed(await inSandbox(files, step.program, step.output), MASKS);
        expect(rifty).toEqual(PINS[step.program]);
        expect(rifty, 'the pin is a gap against live Node').not.toEqual(node);
      },
    );
  }
});

describe('the isolate mask', () => {
  it("rewrites only a rifty bundle frame's line and column", () => {
    const stderr =
      'E: x\n    at f (rifty-isolate-guest.js:20:12)\n    at g (/workspace/a.js:3:4)\n';
    expect(pinOf({ exitCode: 1, stdout: '', stderr, output: null }, MASKS).stderr).toBe(
      'E: x\n    at f (rifty-isolate-guest.js:<line>)\n    at g (/workspace/a.js:3:4)\n',
    );
  });
});
