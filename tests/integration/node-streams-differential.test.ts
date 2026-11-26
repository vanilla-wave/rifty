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
import { createHash } from 'node:crypto';
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
 * pin stays) and today's rifty value. Units 1, 2, 3 and 4b landed: their rows are equal. Measured
 * with the program on rifty's `process` (the core's), main be99bee9e.
 */
// TODO(backlog: runtime-js/fs-writev-fsync)
const WRITEV = 'runtime-js/fs-writev-fsync';
// TODO(backlog: runtime-js/fs-callbacks-io-turn)
const IO_TURN = 'runtime-js/fs-callbacks-io-turn';
// TODO(backlog: runtime-js/stream-core-abort-listeners-host-event-target)
const AL = 'runtime-js/stream-core-abort-listeners-host-event-target';
// TODO(backlog: runtime-js/post-guest-paths-use-replaceable-intrinsics)
const LIVE = 'runtime-js/post-guest-paths-use-replaceable-intrinsics';
// Every row where the core shows rifty's EventEmitter, not Node's (its table of dependency points).
// TODO(backlog: runtime-js/events-static-surface)
const EVENTS = 'runtime-js/events-static-surface';
// TODO(backlog: runtime-js/browser-host-realm-uncaught-fatal-report)
const BROWSER_FATAL = 'runtime-js/browser-host-realm-uncaught-fatal-report';
// `process.argv0` is `'rifty'`: a warning's `(Use \`rifty --trace-deprecation …\`)` hint.
// TODO(backlog: runtime-js/process-versions-node-honesty)
const IDENTITY = 'runtime-js/process-versions-node-honesty';
// TODO(backlog: runtime-js/file-url-host-error-platform)
const FILE_URL = 'runtime-js/file-url-host-error-platform';
// TODO(backlog: runtime-js/inspect-default-format-gaps)
const INSPECT = 'runtime-js/inspect-default-format-gaps';
interface Pin {
  readonly owner: string;
  /** Today's rifty value; more than one only where the value is set by speed (declared at the pin). */
  readonly rifty: readonly string[];
}
const pin = (owner: string, ...rifty: string[]): Pin => ({ owner, rifty });
const PINNED: Readonly<Record<string, Readonly<Record<string, Pin>>>> = {
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
    // The row prints `no settle in 3s` when the write outlasts the program's bound (CI load).
    'timers run while a WriteStream writes 16 MiB in 64 KiB chunks': pin(
      IO_TURN,
      'bytes=16777216,ticks>0=false',
      'bytes=16777216,ticks>0=false,no settle in 3s',
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
  // rifty's EventEmitter keeps listeners in `_listenersMap`; the core's `eventNames` walks `_events`.
  'p2-emitter-store': {
    'Readable eventNames, _events keys, _eventsCount': pin(
      EVENTS,
      '[] close,error,data,end,readable undefined',
    ),
    'Writable eventNames, error listeners': pin(EVENTS, '[] 1'),
    'pipe destination: error listeners, eventNames': pin(EVENTS, '1 []'),
  },
  // io's EventEmitter.emit reads `slice` live: the run dies (exit 1), Node completes.
  'p1-intrinsics-replaced: Array.prototype.slice throws': {
    exit: pin(LIVE, '1'),
    stderr: pin(LIVE, 'Error: replaced slice called\n'),
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
    'Function.prototype.bind throws': pin(EVENTS, 'A.B.C. 12 hello intrinsics finished:ok'),
  },
  'm10-abort-order-leak': {
    'listeners left on the signal after 10000 completed reduce({signal})': pin(
      EVENTS,
      'listeners=n/a',
    ),
    'listeners left on the signal after 40000 completed finished(r, {signal})': pin(
      EVENTS,
      'listeners=n/a',
    ),
  },
  'e1-unhandled-error': {
    stderr: pin(EVENTS, 'Error: boom\n'),
  },
  'e2-unhandled-non-error': {
    stderr: pin(EVENTS, "Error: Unhandled 'error' event: str\n"),
  },
  'e3-max-listeners': {
    stderr: pin(
      EVENTS,
      'MaxListenersExceededWarning: 11 end listeners added. Use setMaxListeners() to increase the limit.\nMaxListenersExceededWarning: 11 data listeners added. Use setMaxListeners() to increase the limit.\n',
    ),
    'setMaxListeners(-1)': pin(EVENTS, 'no throw'),
    'warning events': pin(EVENTS, 'none'),
  },
  'e4-emitter-surface': {
    store: pin(EVENTS, 'undefined []'),
    errorMonitor: pin(EVENTS, 'error'),
    'legacy Stream eventNames': pin(EVENTS, 'threw Reflect.ownKeys called on non-object'),
    'listenerCount(ev, fn)': pin(EVENTS, '2'),
    'statics on/getEventListeners': pin(EVENTS, 'undefined undefined'),
    captureRejections: pin(EVENTS, 'unhandledRejection rejection'),
  },
  'f1-file-url': {
    host: pin(
      FILE_URL,
      'TypeError|ERR_INVALID_FILE_URL_HOST|File URL host must be "localhost" or empty on a POSIX platform',
    ),
  },
  'p1-intrinsics-replaced: Array.prototype.shift throws': {
    stderr: pin(BROWSER_FATAL, 'Error: replaced shift called\n'),
  },
  'p1-intrinsics-replaced: Array.prototype.splice throws': {
    stderr: pin(BROWSER_FATAL, 'Error: replaced splice called\n'),
  },
  'p1-intrinsics-replaced: String.prototype.slice throws': {
    'String.prototype.slice throws': pin(LIVE, 'threw replaced slice called'),
  },
  'p1-intrinsics-replaced: String.prototype.includes throws': {
    'String.prototype.includes throws': pin(LIVE, 'threw replaced includes called'),
  },
  'p1-intrinsics-replaced: String.prototype.startsWith throws': {
    'String.prototype.startsWith throws': pin(LIVE, 'threw replaced startsWith called'),
  },
  'p1-intrinsics-replaced: String.prototype.endsWith throws': {
    'String.prototype.endsWith throws': pin(LIVE, 'threw replaced endsWith called'),
  },
  'p1-intrinsics-replaced: String.prototype.split throws': {
    'String.prototype.split throws': pin(LIVE, 'threw replaced split called'),
  },
  'p1-intrinsics-replaced: Map.prototype.get throws': {
    'Map.prototype.get throws': pin(LIVE, 'threw replaced get called'),
  },
  'p1-intrinsics-replaced: Map.prototype.set throws': {
    'Map.prototype.set throws': pin(LIVE, 'threw replaced set called'),
  },
  'p1-intrinsics-replaced: Map.prototype.delete throws': {
    exit: pin(LIVE, '1'),
    stderr: pin(LIVE, 'Error: replaced delete called\n'),
    'Map.prototype.delete throws': pin(LIVE, '(no row)'),
    'line 2': pin(LIVE, '(no row)'),
    'line 1': pin(LIVE, ''),
  },
  'p1-intrinsics-replaced: Number.isInteger throws': {
    'Number.isInteger throws': pin(LIVE, 'threw replaced isInteger called'),
  },
  // rifty's util.inspect prints a function without its own properties.
  'p3-function-names': {
    Readable: pin(INSPECT, '"Readable"/1 [Function: Readable]'),
    pipeline: pin(INSPECT, '"pipeline"/0 [Function: pipeline]'),
  },
  'p4-binding-paths': {
    stderr: pin(
      IDENTITY,
      '(node:<pid>) [DEP0135] DeprecationWarning: ReadStream.prototype.open() is deprecated\n(Use `rifty --trace-deprecation ...` to show where the warning was created)\n',
    ),
  },
};
/** Exit codes other than 0 the live-Node run of an item must have (its oracle); any other is red. */
const EXIT: Readonly<Record<string, number>> = {
  'e1-unhandled-error': 1,
  'e2-unhandled-non-error': 1,
  'p1-intrinsics-replaced: Array.prototype.shift throws': 1,
  'p1-intrinsics-replaced: Array.prototype.splice throws': 1,
};
/**
 * Rows whose value a race inside Node sets (timer vs libuv pool, two timers under load): each
 * column's value must be one of Node's declared outcomes, each seen from live Node.
 */
const RACES: Readonly<
  Record<string, Readonly<Record<string, { why: string; node: readonly string[] }>>>
> = {
  'b1-bindings': {
    'fs.read callback vs a timer due now': {
      why: 'the pool read completes before or after the check phase (live Node under load: 1 of 36 runs `immediate` first, CI run 2026-11-26)',
      node: ['timer,read cb,immediate', 'timer,immediate,read cb'],
    },
  },
  'm1-hooks-matrix': {
    'Writable async _destroy callback': {
      why: 'a 1 ms and a 3 ms timer fire in one loop turn or two (CI run 2026-11-26: live Node one order, the core on Node bindings the other)',
      node: ['D,sync errored=e,t1,Dcb,error e,close', 'D,sync errored=e,Dcb,error e,close,t1'],
    },
  },
};
/**
 * Written files whose bytes a race inside Node sets: in every column the file must be one of the
 * declared outcomes (sha256), which then reads as `<one of …>`; any other bytes stay as they are.
 */
const MASKED_OUTPUT: Readonly<
  Record<string, Readonly<Record<string, { why: string; sha256: readonly string[] }>>>
> = {
  'w1-fs-windows': {
    'win-4.out': {
      why: 'ws.destroy(err) on the first data of a pipe: whether the chunk lands before the close is the open/write race in the libuv pool (live Node, review: about half of the runs each)',
      sha256: [
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // 0 B
        'df6f952f2f8794b613eec11e48a3930ca44118919f7b525051a1b4f7b0d63196', // the first 1024 B of win.txt
      ],
    },
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
    ...[
      ...Object.keys(PINNED),
      ...Object.keys(MASKED_OUTPUT),
      ...Object.keys(RACES),
      ...Object.keys(EXIT),
    ]
      .filter((k) => !ITEMS.some((i) => i.id === k))
      .map((k) => `PINNED/MASKED_OUTPUT/RACES/EXIT names an item not run: ${k}`),
    ...[...all]
      .filter((k) => !(k in NOT_RUN) && !ITEMS.some((i) => i.id === k))
      .map((k) => `neither run nor listed: ${k}`),
  ];
}

/**
 * stderr without what the module loader, not the program, decides: stack frames, and the
 * `<file>:<line>` + source line + caret block Node prints above an uncaught error (V8 places the
 * caret by the loader's compile: Node's CJS vs rifty's loader); the pid of a `(node:<pid>)` warning.
 */
const stderrOf = (stderr: string): string =>
  stderr
    .replace(/^\(node:\d+\) /gm, '(node:<pid>) ')
    .replace(/^\S[^\n]*:\d+\n[^\n]*\n[ \t]*\^+[ \t]*\n/gm, '')
    .split('\n')
    .filter((l) => !/^\s+at /.test(l))
    .join('\n');

/** A whole outcome as rows: `exit`, `stderr` (frames dropped), `output`, each stdout line. */
async function rowsOf(
  o: Outcome,
  masked: Readonly<Record<string, { sha256: readonly string[] }>> = {},
): Promise<Map<string, string>> {
  const rows = new Map<string, string>();
  rows.set('exit', String(o.exitCode));
  rows.set('stderr', stderrOf(o.stderr));
  const written = new Map(o.written);
  for (const [path, { sha256 }] of Object.entries(masked)) {
    const bytes = written.get(path);
    if (bytes && sha256.includes(createHash('sha256').update(bytes).digest('hex')))
      written.set(path, Buffer.from('<one of MASKED_OUTPUT>'));
  }
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

  it("every binding behaves as Node's own on the same inputs (bindings-vs-node.mts)", () => {
    const r = spawnSync(
      process.execPath,
      [
        '--expose-internals',
        '--import',
        join(repo, 'node_modules/tsx/dist/loader.mjs'),
        join(here, 'node-streams-differential/bindings-vs-node.mts'),
      ],
      { encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  }, 60_000);

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
        const races = RACES[item.id] ?? {};
        const oracle: string[] = [];
        const differs: Record<string, { owner: string; rifty: string }> = {};
        const unpinnedEqual: string[] = [];
        const expectedExit = String(EXIT[item.id] ?? 0);
        if (node.get('exit') !== expectedExit)
          oracle.push(`live Node exit ${node.get('exit')}, expected ${expectedExit} (EXIT)`);
        for (const k of keys) {
          const [n, nc, r] = [node.get(k), nodeCore.get(k), rifty.get(k)];
          const race = races[k];
          if (race === undefined) {
            if (n !== nc)
              oracle.push(`${k}: node ${JSON.stringify(n)} / node-core ${JSON.stringify(nc)}`);
          } else
            for (const [col, v] of [
              ['node', n],
              ['node-core', nc],
            ] as const)
              if (!race.node.includes(v ?? ''))
                oracle.push(`${k}: ${col} ${JSON.stringify(v)} is no declared outcome`);
          const equal = race === undefined ? nc === r : race.node.includes(r ?? '');
          const p = pins[k];
          if (p === undefined) {
            if (!equal) differs[k] = { owner: '?', rifty: r ?? '(no row)' };
          } else if (equal) unpinnedEqual.push(`${k}: equal now, drop its pin (owner ${p.owner})`);
          else if (!p.rifty.includes(r ?? '(no row)'))
            differs[k] = { owner: p.owner, rifty: r ?? '(no row)' };
        }
        expect({ oracle, differs, unpinnedEqual }).toEqual({
          oracle: [],
          differs: {},
          unpinnedEqual: [],
        });
      },
      3 * RUN_TIMEOUT_MS,
    );
});
