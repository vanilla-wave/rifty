/**
 * The node-streams goal's User scenario (docs/backlog/epics/node-streams-as-in-node, map item 0) as
 * programs run by `node <program>` in their own directory, and the live oracle: real Node on this
 * runner over the same files. Shared by the isolate-host test and the browser-host specs
 * (tests/browser-unit, tests/no-coi); no sandbox import.
 *
 * Carrier decisions:
 * - Programs: the 10 `c-*` (every host) and the matrices `m1`–`m10`, `w1`, `b1` (browser hosts),
 *   here in `fixtures/streams-scenario/`, their one source (the goal's probe `run.mjs` reads them
 *   here; the goal's dir under `docs/` goes when the goal closes). A `c-*` program gets exceljs 4.4.0's installed
 *   closure as `node_modules`.
 * - Written output: every file the run leaves in its directory outside `node_modules`, the program
 *   excepted, as `<path> <entry>` lines (`manifest`: sha256, an archive by entry: `entriesOf`), in
 *   the zlib carrier's `Observed.output`.
 * - Pins, masks: the zlib carrier's (`Pin`, `pinOf`, `Mask`, `browserMasks`).
 * - Owners: the units that own the program's rows differing from Node, from the goal's
 *   `reference/results/ownership.txt` (its in-process rows, and isolate rows where that host runs the
 *   program; the browser hosts' rows are
 *   not in that table).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closureFiles } from './closure-files.ts';
import { ooxmlParts } from './ooxml-parts.ts';
import type { Observed } from './zlib-scenario.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PROGRAMS = join(here, 'fixtures/streams-scenario');
const fromHost = createRequire(join(here, '../package.json'));
const EXCELJS = realpathSync(dirname(fromHost.resolve('exceljs/package.json')));

export interface Program {
  /** The file name without `.cjs`. */
  readonly id: string;
  /** The goal's scenario item, or the matrix's subject. */
  readonly title: string;
  /** Units owning the rows that differ from Node today; empty: a guard, equal to Node. */
  readonly owners: readonly string[];
}
const program = (id: string, title: string, ...owners: string[]): Program => ({
  id,
  title,
  owners,
});

export const CARRIER: readonly Program[] = [
  program(
    'c-xlsx-roundtrip',
    'scenario 1: exceljs xlsx.writeBuffer → readFile → edit → writeFile → reload',
    '9r',
  ),
  program('c-csv-write-file', 'scenario 1: exceljs csv.writeFile'),
  program(
    'c-csv-read',
    'scenario 2: exceljs csv.readFile (createReadStream().pipe(fast-csv))',
    '9r',
  ),
  program('c-graceful-fs', 'scenario 3: graceful-fs createWriteStream then createReadStream', '9w'),
  program('c-unzip-stored', 'scenario 3: unzipper Extract of a STORE zip', '9w'),
  program('c-for-await', 'scenario 4: for await over fs.createReadStream', '9r'),
  program('c-late-listener', "scenario 4: a 'data' listener after several awaits", '9r'),
  program('c-readable-read', "scenario 4: on('readable') + read() loop", '9r'),
  program(
    'c-transform-big',
    'scenario 5: 16 MiB through an async Transform into fs.WriteStream',
    '9r',
  ),
  program(
    'c-pipeline-asyncgen',
    'scenario 6: promises.pipeline(ReadStream, async function*, WriteStream)',
    '9r',
  ),
];
export const MATRICES: readonly Program[] = [
  program('m1-lifecycle', 'stream lifecycle hooks', '8c'),
  program('m2-core-members', 'core Readable/Writable members', '8c', '9r', '9w'),
  program('m3-legacy-stream', 'legacy Stream in the class chain', '8c', '9w'),
  program('m4-readstream', 'fs.ReadStream rows', '4', '9r'),
  program('m5-writestream', 'fs.WriteStream rows', '9w'),
  program('m6-transform-duplex', 'Transform backpressure, Duplex members', '8c'),
  program('m7-pipeline-stages', 'pipeline stages, pipeline/finished callbacks', '8c'),
  program('m8-constructor-options', 'constructor option validation', '8c'),
  program(
    'm9-abort-stop-propagation',
    'abort listeners under stopImmediatePropagation',
    '8c',
    'AL',
  ),
  program('m10-abort-order-leak', 'abort order and leftover listeners', '8c'),
  program('w1-fs-windows', 'fs streams between units (windows)', '9r', '9w'),
  program(
    'b1-bindings',
    'bindings: string_decoder, Buffer names, addAbortListener, writev/fsync',
    '5',
  ),
];

/**
 * Workbench's declared skips, each until its owner lands. The marker ties each to its owner's
 * backlog item: removing the item reds `backlog:check` while the skip stays. A whole program:
 */
export const WORKBENCH_SKIPPED: Readonly<Record<string, string>> = {
  // TODO(backlog: runtime-js/fs-fd-write-by-range)
  'c-transform-big':
    'skipped until runtime-js/fs-fd-write-by-range (4c): 16 MiB through fs.WriteStream on the quadratic positional fd write path does not finish in 180 s',
};
/**
 * …and single rows on both browser hosts, skipped by the program's own `--skip=` on both sides (the
 * Node oracle and the guest run the same rows), the other rows pinned. A row whose outcome is set by
 * speed is pinned on no host where it behaves so.
 */
export const BROWSER_SKIPPED_ROWS: Readonly<
  Record<string, readonly { readonly row: string; readonly why: string }[]>
> = {
  'm5-writestream': [
    {
      // TODO(backlog: runtime-js/fs-fd-write-by-range)
      row: 'timers run while a WriteStream writes 16 MiB in 64 KiB chunks',
      why: 'until runtime-js/fs-fd-write-by-range (4c): the row prints `no settle in 3s` only when the write outlasts 3 s, an outcome set by speed. Workbench: 256 positional 64 KiB writes on the quadratic fd write path take about 16 min; SDK: about 3 s, on either side of the bound (CI run 45737744755 printed it, 12 local runs did not)',
    },
  ],
};
/** `node <program> <args>`: the program's `--skip=` of `rows`. */
export const skipArgs = (rows: readonly { readonly row: string }[] = []): string[] =>
  rows.map(({ row }) => `--skip=${encodeURIComponent(row)}`);

/** The case's title tail: who turns it green, or that it is a guard. */
export const verdict = (p: Program): string =>
  p.owners.length === 0
    ? 'equal to Node today (guard)'
    : `today pinned; owners ${p.owners.join(', ')} (goal reference/results/ownership.txt)`;

export const programFile = (p: Program): string => `${p.id}.cjs`;

/** The program's directory before the run: the program, and the exceljs closure for a `c-*`. */
let closure: ReadonlyMap<string, Uint8Array> | undefined;
export function workspace(p: Program): Map<string, Uint8Array> {
  if (closure === undefined && p.id.startsWith('c-')) {
    const { version } = JSON.parse(readFileSync(join(EXCELJS, 'package.json'), 'utf8')) as {
      version: string;
    };
    if (version !== '4.4.0') throw new Error(`exceljs@${version} installed, goal names 4.4.0`);
    closure = closureFiles('exceljs', EXCELJS);
  }
  const files = new Map(p.id.startsWith('c-') ? (closure ?? []) : []);
  files.set(programFile(p), readFileSync(join(PROGRAMS, programFile(p))));
  return files;
}

/** Is `path` (directory-relative, `/`-separated) a written file of `p`'s run? */
export const isWritten = (p: Program, path: string): boolean =>
  path !== programFile(p) && path !== 'node_modules' && !path.startsWith('node_modules/');

/**
 * Is a written file a zip archive (`.xlsx` too), compared by part? Its bytes carry the write time
 * (entry dates; an xlsx's `docProps/core.xml`), so they differ run to run, in Node too.
 */
export const ARCHIVE = /\.(?:xlsx|zip)$/;
export const isArchive = (path: string): boolean => ARCHIVE.test(path);

const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const sha256Entry = (hex: string): string => `sha256 ${hex}`;

/** A zip's central directory: each entry's name and compression method (0 STORE, 8 DEFLATE). */
function zipDirectory(bytes: Uint8Array): { name: string; method: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('no end of central directory');
  const out: { name: string; method: number }[] = [];
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error(`no central header at ${at}`);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    out.push({ name, method: view.getUint16(at + 10, true) });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

/**
 * A written file's manifest entries: `[path, 'sha256 <hex>']`; an archive one per zip entry,
 * `[<path>!<entry>, 'method <n> dir' | 'method <n> sha256 <hex>']`, the content as `ooxmlParts` gives
 * it (the web-api carrier's comparison: `docProps/core.xml` timestamps masked, nothing else).
 */
export async function entriesOf(path: string, bytes: Uint8Array): Promise<[string, string][]> {
  if (!isArchive(path)) return [[path, sha256Entry(sha256(bytes))]];
  try {
    const parts = await ooxmlParts(bytes);
    return zipDirectory(bytes).map(({ name, method }) => [
      `${path}!${name}`,
      name.endsWith('/')
        ? `method ${method} dir`
        : `method ${method} ${sha256Entry(sha256(parts[name] ?? ''))}`,
    ]);
  } catch (e) {
    return [[path, `unreadable zip: ${(e as Error).name}: ${(e as Error).message}`]];
  }
}

/** Written files as sorted `<path> <entry>` lines; null when the run wrote none. */
export function manifest(entries: Iterable<readonly [string, string]>): string | null {
  const lines = [...entries].map(([path, entry]) => `${path} ${entry}`).sort();
  return lines.length === 0 ? null : `${lines.join('\n')}\n`;
}
export const manifestOf = async (
  written: ReadonlyMap<string, Uint8Array>,
): Promise<string | null> =>
  manifest((await Promise.all([...written].map(([path, b]) => entriesOf(path, b)))).flat());

/** The oracle's bound; each host's test limit leaves room for it and the host's own bound. */
export const ORACLE_TIMEOUT_MS = 60_000;

/** Real Node v24.16.0: `node <program> <args>` in a fresh directory holding `workspace(p)`; fails unless it exits on its own. */
export async function inNode(p: Program, args: readonly string[] = []): Promise<Observed> {
  if (process.version !== 'v24.16.0')
    throw new Error(`oracle is Node v24.16.0, this is ${process.version}`);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'streams-scenario-oracle-')));
  try {
    for (const [rel, data] of workspace(p)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), data);
    }
    const r = spawnSync(process.execPath, [programFile(p), ...args], {
      cwd: dir,
      env: {},
      encoding: 'utf8',
      timeout: ORACLE_TIMEOUT_MS,
    });
    if (r.error !== undefined || r.signal !== null || r.status === null)
      throw new Error(
        `oracle ${p.id} did not finish on its own: ${r.error?.message ?? `signal ${r.signal}`}`,
      );
    const written = new Map<string, Uint8Array>();
    const walk = (abs: string): void => {
      for (const name of readdirSync(abs)) {
        const path = join(abs, name);
        const rel = relative(dir, path).split('\\').join('/');
        if (!isWritten(p, rel)) continue;
        if (statSync(path).isDirectory()) walk(path);
        else written.set(rel, readFileSync(path));
      }
    };
    walk(dir);
    return {
      exitCode: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      output: await manifestOf(written),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
