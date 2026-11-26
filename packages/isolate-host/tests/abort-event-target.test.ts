/**
 * Isolate guest `EventTarget`/`Event`/`CustomEvent`/`AbortController`/`AbortSignal` (ADR-0579;
 * goal `node-streams-as-in-node` unit 7, carrying I3 of goal `isolate-guest-web-api`): the unit's
 * pins (`fixtures/web-api/abort-cases.cjs`: globals, shapes, names, errors, statics, the `signal`
 * APIs), the intrinsic-replacement table (`abort-intrinsics.cjs`), lifecycle, and the streams
 * goal's `m7`/`m9`/`m10` rows — each run unchanged by live `node`, a sandbox `exec` and `runCode`.
 * Every line equals Node's except the declared ones (`DECLARED`: the guest's literal, its owner).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCode } from '../src/index.ts';
import { burnedAfter } from './support.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GAP = '(not available in the rifty isolate host, ADR-0557)';
const NOT_ABORT = 'throw DOMException|AbortError [20]: This operation was aborted';

type Declared = Readonly<Record<string, string>>;
/** `abort-cases.cjs` lines where the guest is not Node: the guest's literal; owner in the comment. */
const CASES_DECLARED: Declared = {
  // The guest's `DOMException` (web-shim, also Blob's): `message` is an own property (Node: a
  // prototype getter). backlog distribution/isolate-guest-domexception-node-shape.
  'default reason own keys': 'stack,message',
  // rifty's `inspect` reads no `inspect.custom` hook (compat `util.inspect.custom`;
  // backlog runtime-js/util-surface-completions): the warning text and the inspect rows.
  'MaxListeners warning':
    '"MaxListenersExceededWarning Possible EventTarget memory leak detected. 11 y listeners added to [Object]. MaxListeners is 10. Use events.setMaxListeners() to increase limit count=11 type=y"',
  'util.inspect(controller)': '"AbortController {}"',
  'util.inspect(signal)': '"AbortSignal {}"',
  'util.inspect(event)': '"Event {}"',
  // rifty's `events` surface (every host): backlog runtime-js/events-static-surface.
  'typeof events.on': '"undefined"',
  'typeof events.getEventListeners': '"undefined"',
  'typeof events.setMaxListeners': '"undefined"',
  // rifty's `timers/promises` rejects with the reason itself (every host):
  // backlog runtime-js/signal-apis-as-node.
  'timers/promises.setTimeout aborted': NOT_ABORT,
  'timers/promises.setTimeout abort later': NOT_ABORT,
  'timers/promises.setImmediate aborted': 'throw why',
  'timers/promises.setInterval aborted': NOT_ABORT,
  // TODO(backlog: runtime-js/signal-apis-as-node) fs `signal` lands on top of #468 (unit 7).
  'fs.readFile signal aborted': '"abc"',
  'fs.promises.readFile signal aborted': '"abc"',
  'fs.promises.writeFile signal aborted': 'undefined',
  'g.txt exists': 'true',
  // Transferring a signal (`structuredClone`/`postMessage` are ceilings): the MessageChannel gap.
  'signal[kTransferList]()': `throw NotImplementedError|NotImplementedError: Not implemented: isolate-host.MessageChannel ${GAP}`,
};
/** `abort-intrinsics.cjs`: rifty's runtime patches `Promise.prototype.then` (its `nextTick` drain)
 * over a live `Function.prototype.call`, and its `nextTick` pushes to a live array: an object
 * listener's promise (Node's `addCatch`) reaches both (compat "Guest code replacing JS intrinsics
 * rifty's runtime uses"; backlog runtime-js/post-guest-paths-use-replaceable-intrinsics). */
const INTRINSICS_DECLARED: Declared = {
  'EventTarget add/dispatch/remove': 'throw Error: poisoned push',
  log: 'fn x,fn x,obj,abort listener,onabort',
};

const parse = (stdout: string): Map<string, string> =>
  new Map(
    stdout
      .trimEnd()
      .split('\n')
      .map((line) => {
        const tab = line.indexOf('\t');
        // A last row with an empty value lost its tab to `trimEnd`.
        return tab < 0
          ? ([line, ''] as const)
          : ([line.slice(0, tab), line.slice(tab + 1)] as const);
      }),
  );

/** `node <name>` over `source` in a fresh directory, this very Node (the oracle). */
function inNode(name: string, source: string, args: readonly string[] = []) {
  if (process.version !== 'v24.16.0')
    throw new Error(`oracle is Node v24.16.0, this is ${process.version}`);
  const dir = mkdtempSync(join(tmpdir(), 'abort-cases-'));
  try {
    writeFileSync(join(dir, name), source);
    const r = spawnSync(process.execPath, [name, ...args], { cwd: dir, env: {}, encoding: 'utf8' });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function inSandbox(name: string, source: string, options: Record<string, unknown> = {}) {
  const sb = await createSandbox();
  try {
    await sb.writeFile(name, source);
    return await sb.exec(name, options);
  } finally {
    await sb.destroy();
  }
}

function compare(guest: Map<string, string>, node: Map<string, string>, declared: Declared) {
  expect([...guest.keys()]).toEqual([...node.keys()]);
  const want = new Map(node);
  for (const [id, literal] of Object.entries(declared)) {
    expect(want.get(id), `${id}: declared, still a gap against Node`).not.toBe(literal);
    want.set(id, literal);
  }
  expect(Object.fromEntries(guest)).toEqual(Object.fromEntries(want));
}

for (const [name, declared] of [
  ['abort-cases.cjs', CASES_DECLARED],
  ['abort-intrinsics.cjs', INTRINSICS_DECLARED],
] as const) {
  const source = readFileSync(join(here, 'fixtures/web-api', name), 'utf8');
  describe(`${name}: the guest equals Node v24.16.0`, () => {
    const node = inNode(name, source);
    it('Node runs it cleanly', () => {
      expect({ stderr: node.stderr, exitCode: node.exitCode }).toEqual({ stderr: '', exitCode: 0 });
    });
    it('as a sandbox exec', { timeout: 120_000 }, async () => {
      const r = await inSandbox(name, source);
      expect({ stderr: r.stderr, exitCode: r.exitCode }).toEqual({ stderr: '', exitCode: 0 });
      compare(parse(r.stdout), parse(node.stdout), declared);
    });
    it('as runCode', { timeout: 120_000 }, async () => {
      const r = await runCode(source);
      expect({ stderr: r.stderr, exitCode: r.exitCode }).toEqual({ stderr: '', exitCode: 0 });
      compare(parse(r.stdout), parse(node.stdout), declared);
    });
  });
}

describe('lifecycle', () => {
  it('a pending AbortSignal.timeout does not keep the process alive, as in Node', async () => {
    const code =
      "const s = AbortSignal.timeout(2e9); s.addEventListener('abort', () => console.log('fired')); console.log('end');";
    expect(inNode('t.cjs', code)).toEqual({ stdout: 'end\n', stderr: '', exitCode: 0 });
    // A held process would end `termination: 'timeout'` at this bound instead.
    expect(await runCode(code, { timeoutMs: 60_000 })).toEqual({
      stdout: 'end\n',
      stderr: '',
      exitCode: 0,
    });
  });
  it('a timeout signal fires while something else keeps the process alive', async () => {
    const code =
      "const s = AbortSignal.timeout(5); s.onabort = () => { console.log(s.reason.name); clearTimeout(t); }; const t = setTimeout(() => console.log('late'), 60000);";
    expect(inNode('t.cjs', code).stdout).toBe('TimeoutError\n');
    expect(await runCode(code)).toEqual({ stdout: 'TimeoutError\n', stderr: '', exitCode: 0 });
  });
  it(
    'a sandbox stopped with timeout signals and listeners pending ends, leaving no busy worker',
    {
      timeout: 60_000,
    },
    async () => {
      const code =
        'const ac = new AbortController(); for (let i = 0; i < 1000; i++) { AbortSignal.any([ac.signal, AbortSignal.timeout(2e9)]).onabort = () => {}; new EventTarget().addEventListener("x", () => {}, { signal: ac.signal }); } setInterval(() => {}, 1000);';
      const r = await inSandbox('t.cjs', code, { timeoutMs: 1_000 });
      expect(r).toMatchObject({ termination: 'timeout' });
      expect(await burnedAfter(300)).toBeLessThan(50);
    },
  );
});

/** The streams goal's matrices (`fixtures/streams-scenario/`), isolate: unit 7's rows. */
const STREAMS = join(here, 'fixtures/streams-scenario');
const MATRIX: Readonly<Record<string, Declared>> = {
  // rifty's `stream` until unit 8c: no function/async-generator stages, `finished`'s 0-argument
  // success callback; unchanged by unit 7 (was the same).
  'm7-pipeline-stages.cjs': {
    'promises.pipeline(Readable, async gen, Writable)':
      'threw pipeline: argument must be a stream (index 1 received a non-',
    'promises.pipeline(async gen source, Writable)':
      'threw pipeline: argument must be a stream (index 0 received a non-',
    'promises.pipeline(Readable, async fn sink) returns value': 'no settle in 3s',
    'callback pipeline(Readable, async gen, Writable)':
      'threw pipeline: argument must be a stream (index 1 received a non-',
    'async gen stage throws: error reaches callback':
      'threw pipeline: argument must be a stream (index 1 received a non-',
    'pipeline(Readable, PassThrough, Writable) success cb args': 'w z,cb args=1 null',
    'finished(readable) success cb args': 'cb args=1',
    'finished on a Writable destroyed before any write': 'cb args=1 ',
    'finished on a Readable destroyed before end': 'cb args=1 ',
    'finished on a Transform destroyed after a write': 'cb args=1 ',
    'close(cb)-shape (finished + destroy) on a Transform that already errored': '',
  },
  // rifty's `stream` until 8c: `pipeline` takes no options object, `finished` no options.
  'm9-abort-stop-propagation.cjs': {
    'promises.pipeline(r, w, {signal}), abort after a stopping listener': 'threw TypeError',
    'finished(r, {signal}) after a stopping listener': 'pending',
  },
};
describe('streams matrices m7, m9 in the isolate (sandbox exec)', () => {
  for (const [name, declared] of Object.entries(MATRIX)) {
    it(name, { timeout: 120_000 }, async () => {
      const source = readFileSync(join(STREAMS, name), 'utf8');
      const node = inNode(name, source);
      const r = await inSandbox(name, source);
      const rows = (s: string) => parse(s.replaceAll(' => ', '\t'));
      expect(r.exitCode).toBe(node.exitCode);
      compare(rows(r.stdout), rows(node.stdout), declared);
    });
  }
  // m10: rifty's `finished(r, {signal}, cb)` calls the options object (every host, until 8c);
  // `getEventListeners` comes from `process.getBuiltinModule('events')`, rifty's lacks it.
  it('m10-abort-order-leak.cjs', { timeout: 120_000 }, async () => {
    const r = await inSandbox(
      'm10-abort-order-leak.cjs',
      readFileSync(join(STREAMS, 'm10-abort-order-leak.cjs'), 'utf8'),
    );
    expect(r).toMatchObject({
      exitCode: 1,
      stdout:
        'a guest abort listener added after pipeline sees the source destroyed => threw TypeError\nlisteners left on the signal after 10000 completed reduce({signal}) => listeners=n/a\n',
    });
    expect(r.stderr).toContain('TypeError: cb is not a function');
  });
});
