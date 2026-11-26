/**
 * The node-streams goal's User scenario (docs/backlog/epics/node-streams-as-in-node, map item 0) as
 * programs run by `node <program>` in their own directory, and the live oracle: real Node on this
 * runner over the same files. Shared by the isolate-host test and the browser-host specs
 * (tests/browser-unit, tests/no-coi); no sandbox import.
 *
 * Carrier decisions:
 * - Programs: the 10 `c-*` (every host) and the matrices `m1`–`m10`, `w1`, `b1` (browser hosts),
 *   copied from the goal's `reference/programs/`. A `c-*` program gets exceljs 4.4.0's installed
 *   closure as `node_modules`.
 * - Written output: every file the run leaves in its directory outside `node_modules`, the program
 *   excepted, as `<path> <entry>` lines (`manifest`, by sha256 or reloaded values: `entryOf`), in
 *   the zlib carrier's `Observed.output`.
 * - Pins, masks: the zlib carrier's (`Pin`, `pinOf`, `Mask`, `browserMasks`).
 * - Owners: the units that own the program's rows differing from Node, from the goal's
 *   `reference/results/ownership.txt` (in-process and isolate rows; the browser hosts' rows are
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
    '1',
    '3',
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
 * …and single rows, skipped by the program's own `--skip=` on both sides (the Node oracle and the
 * guest run the same rows), the other rows pinned.
 */
export const WORKBENCH_SKIPPED_ROWS: Readonly<
  Record<string, readonly { readonly row: string; readonly why: string }[]>
> = {
  'm5-writestream': [
    {
      // TODO(backlog: runtime-js/fs-fd-write-by-range)
      row: 'timers run while a WriteStream writes 16 MiB in 64 KiB chunks',
      why: 'until runtime-js/fs-fd-write-by-range (4c): 256 positional 64 KiB writes on the quadratic fd write path take about 16 min, and the row prints `no settle in 3s` only because the write outlasts 3 s (an outcome set by speed)',
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
 * Is a written file compared by the values a reload reads, not by its bytes? A zip (`.xlsx` too)
 * carries its write time (entry dates; an xlsx's docProps), so its bytes differ run to run, in
 * Node too.
 */
export const RELOADED = /\.(?:xlsx|zip)$/;
export const isReloaded = (path: string): boolean => RELOADED.test(path);

const ExcelJS = fromHost('exceljs') as {
  Workbook: new () => {
    xlsx: { load(data: Uint8Array): Promise<unknown> };
    worksheets: readonly { name: string; getSheetValues(): unknown[] }[];
  };
};
// exceljs's own JSZip: the reader the programs write zips with, in real Node.
const JSZip = createRequire(join(EXCELJS, 'package.json'))('jszip') as {
  loadAsync(data: Uint8Array): Promise<{
    readonly files: Readonly<
      Record<string, { dir: boolean; async(t: 'uint8array'): Promise<Uint8Array> }>
    >;
  }>;
};
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
/**
 * A written file's manifest entry: `sha256 <hex>`; for `isReloaded`, what real Node reloads: an
 * `.xlsx`'s sheet values by exceljs, a `.zip`'s entries (name, sha256) by JSZip.
 */
export async function entryOf(path: string, bytes: Uint8Array): Promise<string> {
  if (!isReloaded(path)) return sha256Entry(sha256(bytes));
  try {
    if (path.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(bytes);
      const entries = await Promise.all(
        Object.entries(zip.files)
          .filter(([, e]) => !e.dir)
          .map(async ([name, e]) => `${name}=${sha256(await e.async('uint8array'))}`),
      );
      return `entries ${entries.sort().join(' ')}`;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    return `values ${JSON.stringify(wb.worksheets.map((ws) => [ws.name, ws.getSheetValues().filter(Boolean)]))}`;
  } catch (e) {
    return `reload threw ${(e as Error).name}: ${(e as Error).message}`;
  }
}
export const sha256Entry = (hex: string): string => `sha256 ${hex}`;

/** Written files as sorted `<path> <entry>` lines; null when the run wrote none. */
export function manifest(entries: Iterable<readonly [string, string]>): string | null {
  const lines = [...entries].map(([path, entry]) => `${path} ${entry}`).sort();
  return lines.length === 0 ? null : `${lines.join('\n')}\n`;
}
export const manifestOf = async (
  written: ReadonlyMap<string, Uint8Array>,
): Promise<string | null> =>
  manifest(
    await Promise.all(
      [...written].map(async ([path, b]) => [path, await entryOf(path, b)] as const),
    ),
  );

/** Real Node v24.16.0: `node <program> <args>` in a fresh directory holding `workspace(p)`. */
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
      timeout: 120_000,
    });
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
