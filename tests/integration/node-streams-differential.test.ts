/**
 * Stream core 8a differential (docs/backlog/runtime-js/stream-core-node-sources-unwired.md,
 * ADR-0575 §7): Node v24.16.0's generated stream core (io `streams/node/generated/`), not wired
 * into any product module, run by the same program three ways — live Node, the core on Node's own
 * bindings, the core on rifty's bindings (`streams/node/bindings.ts`) — and compared whole: exit
 * code, every stdout line, stderr (stack frames dropped), the files written.
 *
 * - The core on Node's bindings equals live Node on every row: the generated text is Node's.
 * - The core on rifty's bindings equals it on every row but `PINNED`, each pinned on today's rifty
 *   value with the unit that owns it; a pinned row that turns equal is red until its pin goes.
 * - Programs: the goal's carrier and matrices (isolate-host `fixtures/streams-scenario/`) and this
 *   directory's `programs/`; parity cases: `cases/stream` and the `cases/fs` stream cases. Every
 *   one is run or in `NOT_RUN` with its reason (`coverageProblems`).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CARRIER,
  MATRICES,
  manifestOf,
  workspace,
} from '../../packages/isolate-host/tests/streams-scenario.ts';
import {
  COLUMNS,
  type Outcome,
  RUN_TIMEOUT_MS,
  type Run,
  runColumn,
} from './node-streams-differential/harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const FIXTURES = join(repo, 'packages/isolate-host/tests/fixtures/streams-scenario');
const LOCAL = join(here, 'node-streams-differential/programs');
const CASES = join(repo, 'tools/node-parity-runner/cases');

/** Items the differential does not run, with the reason. */
const NOT_RUN: Readonly<Record<string, string>> = {
  'stream/pipe-process-stdio-end-calls.case.ts':
    'stdin case: the parity runner pipes stdin, this differential runs no stdin',
  'stream/pipe-process-stdio-exit.case.ts':
    'node-cli-eval case: process exit through the CLI, not the core',
  'stream/pipe-process-stdio.case.ts': 'stdin case and patches the shared realm',
};
/**
 * Rows where rifty's bindings differ from Node's today (measured on main aa7b332cc): item → row →
 * the owning unit (its backlog item; the marker reds `backlog:check` when the item goes while the
 * pin stays) and today's rifty value. Units 1, 2, 3 and 4b landed: their rows are equal.
 */
// TODO(backlog: runtime-js/fs-writev-fsync)
const WRITEV = 'runtime-js/fs-writev-fsync';
// TODO(backlog: runtime-js/fs-callbacks-io-turn)
const IO_TURN = 'runtime-js/fs-callbacks-io-turn';
// TODO(backlog: runtime-js/stream-core-abort-listeners-host-event-target)
const AL = 'runtime-js/stream-core-abort-listeners-host-event-target';
// TODO(backlog: runtime-js/post-guest-paths-use-replaceable-intrinsics)
const LIVE = 'runtime-js/post-guest-paths-use-replaceable-intrinsics';
// TODO(backlog: runtime-js/events-once-wrapper-bind)
const ONCE_BIND = 'runtime-js/events-once-wrapper-bind';
const pin = (owner: string, rifty: string) => ({ owner, rifty });
const PINNED: Readonly<Record<string, Readonly<Record<string, { owner: string; rifty: string }>>>> =
  {
    'b1-bindings': {
      'fs.writev / fs.fsync / fs.writevSync / fs.fsyncSync types': pin(
        WRITEV,
        'writev:undefined fsync:undefined writevSync:undefined fsyncSync:undefined fdatasync:undefined',
      ),
    },
    'm4-readstream': {
      'timers run while 16 MiB streams (for await)': pin(IO_TURN, 'bytes=16777216,ticks>0=false'),
      'timers run during an fs.read(fd) loop over 16 MiB (the fd source alone)': pin(
        IO_TURN,
        'bytes=16777216,ticks>0=false',
      ),
    },
    'm5-writestream': {
      // Node's WriteStream sets `_writev = null` without `fs.writev` (streams.js:373).
      'member types': pin(
        WRITEV,
        'write:function end:function cork:function uncork:function setDefaultEncoding:function destroy:function close:function destroySoon:function _write:function _writev:object _final:undefined _destroy:function _construct:function open:function',
      ),
      'timers run while a WriteStream writes 16 MiB in 64 KiB chunks': pin(
        IO_TURN,
        'bytes=16777216,ticks>0=false',
      ),
    },
    // Fresh `kResistStopPropagation`/`kWeakHandler` (a host EventTarget ignores them), variant A.
    'm9-abort-stop-propagation': {
      'promises.pipeline(r, w, {signal}), abort after a stopping listener': pin(
        AL,
        'pending,destroyed=false/false',
      ),
      'finished(r, {signal}) after a stopping listener': pin(AL, 'pending'),
      'addAbortSignal(signal, r) after a stopping listener': pin(AL, 'destroyed=false'),
    },
    // io's EventEmitter.emit reads `slice` live: the run dies (exit 1), Node completes.
    'p1-intrinsics-replaced: Array.prototype.slice throws': {
      exit: pin(LIVE, '1'),
      stderr: pin(LIVE, '\nError: replaced slice called\n\nNode.js v24.16.0\n'),
      'line 1': pin(LIVE, ''),
      'Array.prototype.slice throws': pin(LIVE, '(no row)'),
      'line 2': pin(LIVE, '(no row)'),
    },
    // fs.open chains through the live Promise.resolve().then.
    'p1-intrinsics-replaced: Promise.prototype.then throws': {
      'Promise.prototype.then throws': pin(LIVE, 'threw replaced then called'),
    },
    'p1-intrinsics-replaced: globalThis.Promise is another class': {
      'globalThis.Promise is another class': pin(LIVE, 'threw Promise.resolve is not a function'),
    },
    // Node's events `_onceWrap` reads `bind` live and throws; rifty's `once` does not.
    'p1-intrinsics-replaced: Function.prototype.bind throws': {
      'Function.prototype.bind throws': pin(ONCE_BIND, 'A.B.C. 12 hello intrinsics finished:ok'),
    },
  };
/** Written files whose bytes a race inside Node sets, masked in every column (path → why). */
const MASKED_OUTPUT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'w1-fs-windows': {
    'win-4.out':
      'ws.destroy(err) on the first data of a pipe: whether the chunk is written before the close is the race of the open/write in the libuv pool (Node alone: empty or 1024 bytes)',
  },
};

interface Item {
  readonly id: string;
  readonly run: () => Promise<Run>;
}
const fixtureProgram = (id: string): Item => {
  const p = [...CARRIER, ...MATRICES].find((q) => q.id === id);
  if (p === undefined) throw new Error(`${id}: not a carrier program`);
  return {
    id,
    run: async () => ({
      entry: `${id}.cjs`,
      entryFiles: workspace(p),
      cwdFiles: new Map(),
      cwd: '',
      entryInCwd: true,
    }),
  };
};
const localProgram = (file: string, row?: string): Item => ({
  id: `${file.replace(/\.cjs$/, '')}${row === undefined ? '' : `: ${row}`}`,
  run: async () => ({
    entry: file,
    entryFiles: new Map([[file, readFileSync(join(LOCAL, file))]]),
    cwdFiles: new Map(),
    cwd: '',
    entryInCwd: true,
    args: row === undefined ? [] : [`--only=${row}`],
  }),
});
/** Local programs run one row per process (`--list`, `--only=`): a row that ends the process hides no other. */
const PER_ROW = new Set(['p1-intrinsics-replaced.cjs']);
const rowsOfProgram = (file: string): string[] =>
  spawnSync(process.execPath, [join(LOCAL, file), '--list'], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean);
interface ParityCase {
  readonly code: string;
  readonly kind?: string;
  readonly cwd?: string;
  readonly stdin?: unknown;
  readonly nodeCliEval?: unknown;
  readonly expectedPhysicalWorkers?: unknown;
  readonly patchesSharedRealm?: unknown;
  readonly setup?: { readonly files?: Readonly<Record<string, string>> };
}
const caseFiles = (): string[] => [
  ...readdirSync(join(CASES, 'stream'))
    .filter((n) => n.endsWith('.case.ts'))
    .map((n) => `stream/${n}`),
  ...readdirSync(join(CASES, 'fs'))
    .filter((n) => n.endsWith('.case.ts') && n.includes('stream'))
    .map((n) => `fs/${n}`),
];
const parityCase = (path: string): Item => ({
  id: path,
  run: async () => {
    const c = (await import(pathToFileURL(join(CASES, path)).href)).default as ParityCase;
    if ((c.kind ?? 'cjs') !== 'cjs' || c.stdin || c.nodeCliEval || c.expectedPhysicalWorkers)
      throw new Error(`${path}: not a plain CommonJS case; list it in NOT_RUN`);
    const setup = new Map(
      Object.entries(c.setup?.files ?? {}).map(([rel, text]) => [rel, Buffer.from(text)]),
    );
    return {
      entry: 'main.js',
      entryFiles: new Map([...setup, ['main.js', Buffer.from(c.code)]]),
      cwdFiles: setup,
      cwd: (c.cwd ?? '/').replace(/^\/+|\/+$/g, ''),
      entryInCwd: false,
    };
  },
});

const fixtures = readdirSync(FIXTURES)
  .filter((n) => n.endsWith('.cjs'))
  .map((n) => n.replace(/\.cjs$/, ''));
const locals = readdirSync(LOCAL).filter((n) => n.endsWith('.cjs'));
const ITEMS: readonly Item[] = [
  ...fixtures.filter((id) => !(id in NOT_RUN)).map(fixtureProgram),
  ...locals.flatMap((f) =>
    PER_ROW.has(f) ? rowsOfProgram(f).map((r) => localProgram(f, r)) : [localProgram(f)],
  ),
  ...caseFiles()
    .filter((p) => !(p in NOT_RUN))
    .map(parityCase),
];

/** Every program and case is run or listed with a reason; every listing names a real one. */
function coverageProblems(): string[] {
  const all = new Set([
    ...fixtures,
    ...locals.flatMap((f) =>
      PER_ROW.has(f)
        ? rowsOfProgram(f).map((r) => `${f.replace(/\.cjs$/, '')}: ${r}`)
        : [f.replace(/\.cjs$/, '')],
    ),
    ...caseFiles(),
  ]);
  return [
    ...Object.keys(NOT_RUN)
      .filter((k) => !all.has(k))
      .map((k) => `NOT_RUN names no program or case: ${k}`),
    ...[...Object.keys(PINNED), ...Object.keys(MASKED_OUTPUT)]
      .filter((k) => !ITEMS.some((i) => i.id === k))
      .map((k) => `PINNED/MASKED_OUTPUT names an item not run: ${k}`),
    ...[...all]
      .filter((k) => !(k in NOT_RUN) && !ITEMS.some((i) => i.id === k))
      .map((k) => `neither run nor listed: ${k}`),
  ];
}

/**
 * stderr without what the module loader, not the program, decides: stack frames, and the
 * `<file>:<line>` + source line + caret block Node prints above an uncaught error (V8 places the
 * caret by the loader's compile: Node's CJS vs rifty's loader).
 */
const stderrOf = (stderr: string): string =>
  stderr
    .replace(/^\S[^\n]*:\d+\n[^\n]*\n[ \t]*\^+[ \t]*\n/gm, '')
    .split('\n')
    .filter((l) => !/^\s+at /.test(l))
    .join('\n');

/** A whole outcome as rows: `exit`, `stderr` (frames dropped), `output`, each stdout line. */
async function rowsOf(
  o: Outcome,
  masked: Readonly<Record<string, string>> = {},
): Promise<Map<string, string>> {
  const rows = new Map<string, string>();
  rows.set('exit', String(o.exitCode));
  rows.set('stderr', stderrOf(o.stderr));
  const written = new Map(o.written);
  for (const path of Object.keys(masked))
    if (written.has(path)) written.set(path, Buffer.from('<masked: MASKED_OUTPUT>'));
  rows.set('output', (await manifestOf(written)) ?? '(none)');
  const seen = new Map<string, number>();
  o.stdout.split('\n').forEach((line, i) => {
    const arrow = line.indexOf(' => ');
    const name = arrow === -1 ? `line ${i + 1}` : line.slice(0, arrow);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    rows.set(n === 1 ? name : `${name} #${n}`, arrow === -1 ? line : line.slice(arrow + 4));
  });
  return rows;
}

describe('stream core 8a differential: Node v24.16.0 core on Node bindings = on rifty bindings', () => {
  it('runs every program and parity case or lists why not', () => {
    expect(coverageProblems()).toEqual([]);
  });

  for (const item of ITEMS)
    it.concurrent(
      item.id,
      async () => {
        const run = await item.run();
        const [node, nodeCore, rifty] = await Promise.all(
          COLUMNS.map(async (c) => rowsOf(await runColumn(c, run), MASKED_OUTPUT[item.id])),
        );
        const keys = [...new Set([...node.keys(), ...nodeCore.keys(), ...rifty.keys()])];
        const pins = PINNED[item.id] ?? {};
        const oracle: string[] = [];
        const differs: Record<string, { owner: string; rifty: string }> = {};
        const unpinnedEqual: string[] = [];
        for (const k of keys) {
          if (node.get(k) !== nodeCore.get(k))
            oracle.push(
              `${k}: node ${JSON.stringify(node.get(k))} / node-core ${JSON.stringify(nodeCore.get(k))}`,
            );
          if (nodeCore.get(k) !== rifty.get(k))
            differs[k] = { owner: pins[k]?.owner ?? '?', rifty: rifty.get(k) ?? '(no row)' };
          else if (k in pins)
            unpinnedEqual.push(`${k}: equal now, drop its pin (owner ${pins[k]?.owner})`);
        }
        expect({ oracle, differs, unpinnedEqual }).toEqual({
          oracle: [],
          differs: pins,
          unpinnedEqual: [],
        });
      },
      3 * RUN_TIMEOUT_MS,
    );
});
