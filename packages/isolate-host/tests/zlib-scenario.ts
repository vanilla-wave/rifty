/**
 * The node:zlib goal's User scenario (docs/backlog/epics/node-zlib-on-every-host) as ten steps,
 * each one program over its library closure laid out as `node_modules`, and the live oracle: real
 * `node <step>` on this runner over the same files. Shared by the isolate-host test and the
 * browser-host specs (tests/browser-unit, tests/no-coi); no sandbox import.
 *
 * Carrier decisions (PR #453):
 * - Hosts: isolate `exec`; Workbench = tests/browser-unit (sealed fixture, COI), SDK = tests/no-coi
 *   (`createSandbox`), ADR-0571's `node-file-parity` pair.
 * - Inputs: steps 2, 3r, 7a read the oracle's outputs of 1, 3w, 4; 5a, 5b, 7b read `inputs.js`'s,
 *   all made by Node on this runner. Clock frozen in each step (`lib.js`). No step writes gzip, so
 *   the goal's OS-byte rule compares nothing.
 * - Browser: a step's full closure reaches the guest as one routed body, unpacked by a guest
 *   `node`; on the Workbench to `/tmp/z<id>`, keeping the project small (a guest write's cost
 *   grows with its file count: perf/workbench-guest-write-cost-grows-with-project). No closure cut
 *   by fs trace (manager: simplicity over ~35 s of CI).
 * - A pin is the whole outcome; a host's stderr masks are enumerated (`Mask`), nothing else.
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Outcome, closureFiles, inNode } from './closure-files.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PROGRAMS = join(here, 'fixtures/zlib-scenario');
const fromHost = createRequire(join(here, '../package.json'));
const fromRoot = createRequire(join(here, '../../../package.json'));
const pkgDir = (req: NodeJS.Require, name: string): string =>
  realpathSync(dirname(req.resolve(`${name}/package.json`)));
const exceljsDir = pkgDir(fromHost, 'exceljs');
/** Package → installed dir and the version the goal names (scenario: exact). */
const PACKAGES: Readonly<Record<string, { dir: string; version: string }>> = {
  exceljs: { dir: exceljsDir, version: '4.4.0' },
  unzipper: {
    dir: pkgDir(createRequire(join(exceljsDir, 'package.json')), 'unzipper'),
    version: '0.10.14',
  },
  pngjs: { dir: pkgDir(fromHost, 'pngjs'), version: '7.0.0' },
  pdfkit: { dir: pkgDir(fromHost, 'pdfkit'), version: '0.17.2' },
  ws: { dir: pkgDir(fromRoot, 'ws'), version: '8.23.0' },
};

export type StepId = '1' | '2' | '3w' | '3r' | '4' | '5a' | '5b' | '6' | '7a' | '7b';
type Producer = StepId | 'inputs';
export interface Step {
  readonly id: StepId;
  readonly title: string;
  readonly program: string;
  readonly packages: readonly string[];
  /** `in/<name>` ← the oracle's `out/<name>` of that producer. */
  readonly inputs: Readonly<Record<string, Producer>>;
  /** The `out/<name>` file the step writes. */
  readonly output?: string;
}
export const STEPS: readonly Step[] = [
  {
    id: '1',
    title: 'exceljs 4.4.0 streaming WorkbookWriter, 5000 rows → out.xlsx',
    program: '1-exceljs.js',
    packages: ['exceljs'],
    inputs: {},
    output: 'out.xlsx',
  },
  {
    id: '2',
    title: "unzipper 0.10.14 Open.buffer + piped Parse of step 1's xlsx → entries",
    program: '2-unzipper.js',
    packages: ['unzipper'],
    inputs: { 'out.xlsx': '1' },
  },
  {
    id: '3w',
    title: 'pngjs 7.0.0 PNG.sync.write 300×200 → out.png',
    program: '3w-pngjs-write.js',
    packages: ['pngjs'],
    inputs: {},
    output: 'out.png',
  },
  {
    id: '3r',
    title: "pngjs 7.0.0 PNG.sync.read of step 3w's png → pixels",
    program: '3r-pngjs-read.js',
    packages: ['pngjs'],
    inputs: { 'out.png': '3w' },
  },
  {
    id: '4',
    title: 'pdfkit 0.17.2 compressed pdf → out.pdf; inflateSync of each FlateDecode stream',
    program: '4-pdfkit.js',
    packages: ['pdfkit'],
    inputs: {},
    output: 'out.pdf',
  },
  {
    id: '5a',
    title: 'gunzipSync of a two-member .gz',
    program: '5a-gunzip-members.js',
    packages: [],
    inputs: { 'two-members.gz': 'inputs' },
  },
  {
    id: '5b',
    title: 'unzip(cb) of gzip and of zlib input',
    program: '5b-unzip.js',
    packages: [],
    inputs: { 'text.gz': 'inputs', 'text.zz': 'inputs' },
  },
  {
    id: '6',
    title: 'ws 8.23.0 PerMessageDeflate, 4 messages with and without fin',
    program: '6-ws.js',
    packages: ['ws'],
    inputs: {},
  },
  {
    id: '7a',
    title: 'crc32 of every file steps 1, 3w, 4 wrote',
    program: '7a-crc32.js',
    packages: [],
    inputs: { 'out.xlsx': '1', 'out.png': '3w', 'out.pdf': '4' },
  },
  {
    id: '7b',
    title: 'callback inflate of a corrupt buffer → its error',
    program: '7b-inflate-corrupt.js',
    packages: [],
    inputs: { 'corrupt.zz': 'inputs' },
  },
];
/** The map's verdict for every case: green after unit 3; one still red there is unit 4's measured wall. */
export const GREEN_BY = 'expected green after unit 3 (runtime-js/zlib-node-lib-port)';

const program = (name: string): Uint8Array => readFileSync(join(PROGRAMS, name));

/** The step's workspace without its inputs: programs, closures, `package.json`, an empty `out/`. */
function baseFiles(step: Pick<Step, 'program' | 'packages'>): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const name of step.packages) {
    const pkg = PACKAGES[name];
    if (pkg === undefined) throw new Error(`unknown package ${name}`);
    const { version } = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8')) as {
      version: string;
    };
    if (version !== pkg.version)
      throw new Error(`${name}@${version} installed, goal names ${pkg.version}`);
    for (const [path, data] of closureFiles(name, pkg.dir)) files.set(path, data);
  }
  for (const name of ['lib.js', 'image.js', step.program]) files.set(name, program(name));
  // Typeless, so `.js` is CommonJS under any host's root (the Workbench template's is a module).
  files.set('package.json', new TextEncoder().encode('{}\n'));
  files.set('out/.keep', new Uint8Array());
  return files;
}

export interface OracleStep {
  readonly step: Step;
  /** The step's workspace: programs, closures, `in/` (the oracle's own outputs upstream). */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly node: Outcome;
}

/** `node <step>` (argv: its output path); `file`: that output's bytes. */
export const outPath = (step: Step): string => `out/${step.output ?? 'none'}`;

/** Real Node v24.16.0 over every step in dependency order; a step that fails fails here. */
export function runOracle(): ReadonlyMap<StepId, OracleStep> {
  if (process.version !== 'v24.16.0')
    throw new Error(`oracle is Node v24.16.0, this is ${process.version}`);
  const produced = new Map<Producer, (name: string) => Uint8Array | undefined>();
  const inputs = baseFiles({ program: 'inputs.js', packages: [] });
  produced.set('inputs', (name) => inNode(inputs, 'inputs.js', `out/${name}`).file);
  const out = new Map<StepId, OracleStep>();
  for (const step of STEPS) {
    const files = baseFiles(step);
    for (const [name, from] of Object.entries(step.inputs)) {
      const bytes = produced.get(from)?.(name);
      if (bytes === undefined)
        throw new Error(`step ${step.id}: oracle ${from} wrote no out/${name}`);
      files.set(`in/${name}`, bytes);
    }
    const node = inNode(files, step.program, outPath(step));
    if (
      node.exitCode !== 0 ||
      node.stderr !== '' ||
      (step.output !== undefined && node.file === undefined)
    )
      throw new Error(`oracle step ${step.id} failed: ${node.stderr}`);
    produced.set(step.id, (n) => (n === step.output ? node.file : undefined));
    out.set(step.id, { step, files, node });
  }
  return out;
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** A run as compared: the output by the sha256 of its bytes (null: not written). */
export interface Observed {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string | null;
}
export const observed = (run: Outcome): Observed => ({
  exitCode: run.exitCode,
  stdout: run.stdout,
  stderr: run.stderr,
  output: run.file === undefined ? null : sha256(run.file),
});

/** A narrow rewrite of one known variable part of a host's stderr; `why` names what it hides. */
export interface Mask {
  readonly why: string;
  readonly pattern: RegExp;
  readonly to: string;
}

/** A browser host's stderr masks for checkout `_root`; nothing else of it is rewritten. */
export const browserMasks = (_root: string): readonly Mask[] => [
  {
    why: "the dev server's origin (port) and this checkout's path in rifty's own source URLs",
    pattern: /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/@fs\/\S*?\/packages\//g,
    to: '<dev-server>/packages/',
  },
  {
    why: "a run of rifty's own stack frames (their line:col move with any runtime edit); guest frames stay",
    pattern: /(?:^ {4}at (?:.*\()?<dev-server>\/packages\/.*\n)+/gm,
    to: '    at <rifty frames>\n',
  },
];

/**
 * Today's rifty outcome of a step, pinned whole: exit code, stdout, the whole stderr (only the
 * host's enumerated masks applied), the output written.
 */
export interface Pin {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string | null;
}
export const pinOf = (o: Observed, masks: readonly Mask[] = []): Pin => ({
  exitCode: o.exitCode,
  stdout: o.stdout,
  stderr: masks.reduce((text, m) => text.replace(m.pattern, m.to), o.stderr),
  output: o.output,
});
