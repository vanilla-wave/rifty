/**
 * Shared WPT harness (`README.md`): one WPT `.any.js` file + its `META: script=` dependencies +
 * WPT's own `resources/testharness.js` + a shim as Node's runner sets up
 * (`test/common/wpt/worker.js`), concatenated into one CommonJS file that runs unchanged as
 * `node t.cjs` and on a rifty host. The oracle is live Node v24.16.0 per subtest (name, status,
 * message), never Node's status files. Host-agnostic: the consumer runs the file on its host.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures');
const PINS = JSON.parse(readFileSync(join(here, 'fixtures.sha256.json'), 'utf8')) as {
  readonly node: string;
  readonly files: Readonly<Record<string, string>>;
};
export const WPT_NODE = PINS.node;

/** A vendored file by its WPT path, checked against its sha256 pin. */
function fixture(rel: string): string {
  const pin = PINS.files[rel];
  if (pin === undefined) throw new Error(`wpt: ${rel} is not vendored (fixtures.sha256.json)`);
  const bytes = readFileSync(join(FIXTURES, rel));
  if (createHash('sha256').update(bytes).digest('hex') !== pin)
    throw new Error(`wpt: ${rel} differs from its sha256 pin`);
  return bytes.toString('utf8');
}

const REPORT = '__WPT__';
/**
 * The CommonJS file for one WPT test (a path under `fixtures/`). As Node's runner: `self`,
 * `GLOBAL`, `location`, `META_TITLE`, then the harness, the result/completion callbacks, the
 * `META: script=` dependencies and the test. Unlike it: plain concatenation (rifty refuses
 * literal `eval` in a CommonJS module), `location` a plain object (`URL` is an isolate ceiling),
 * no `fetch` mock (add one when a file reads a fixture), a throwing `AbortController` hidden
 * before the harness (it builds one per test when the global is a function), and the report
 * written synchronously before an exit (Node ends its worker; a pipe would cut an async write).
 */
export function wptFile(test: string): string {
  const code = fixture(test);
  const deps = [...code.matchAll(/^\/\/ META: script=(.+)$/gm)].map((m) => {
    const s = (m[1] as string).trim();
    return s.startsWith('/') ? s.slice(1) : posix.join(posix.dirname(test), s);
  });
  const title = /^\/\/ META: title=(.+)$/m.exec(code)?.[1] ?? '';
  const href = `http://web-platform.test:8000/${test.replace(/\.any\.js$/, '.any.html')}`;
  return `globalThis.self = globalThis;
globalThis.GLOBAL = { isWindow() { return false; }, isShadowRealm() { return false; } };
globalThis.location = { href: ${JSON.stringify(href)}, toString() { return this.href; } };
globalThis.META_TITLE = ${JSON.stringify(title)};
try { new AbortController(); } catch { delete globalThis.AbortController; }
const __results = [];
function __report(r) { require('fs').writeSync(1, ${JSON.stringify(REPORT)} + JSON.stringify(r) + '\\n'); process.exit(0); }
const __keep = setTimeout(() => __report({ harness: 2, results: __results }), 60000);
//=== resources/testharness.js
${fixture('resources/testharness.js')}
add_result_callback((r) => __results.push({ name: r.name, status: r.status, message: r.message ?? null }));
add_completion_callback((_, status) => { clearTimeout(__keep); __report({ harness: status.status, results: __results }); });
${deps.map((s) => `//=== ${s}\n${fixture(s)}`).join('\n')}
//=== ${test}
${code}
`;
}

const STATUS = ['PASS', 'FAIL', 'TIMEOUT', 'NOTRUN', 'PRECONDITION_FAILED'] as const;
const HARNESS = ['OK', 'ERROR', 'TIMEOUT', 'PRECONDITION_FAILED'] as const;
export interface Subtest {
  readonly name: string;
  readonly status: string;
  readonly message: string | null;
}
export interface Report {
  /**
   * testharness's completion status (`OK`, …); `no report: …` when the file never completed;
   * `unclean end: …` when the run ended other than exit 0 with an empty stderr, report or not.
   */
  readonly harness: string;
  readonly subtests: readonly Subtest[];
}
export interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  /** A host's own end of the run (isolate host: `'timeout' | 'memory'`). */
  readonly termination?: string;
}

export function parseReport(run: Run): Report {
  // The report exits 0 at once: anything after it (a hang, another exit code, stderr) is a fault.
  if (run.exitCode !== 0 || run.termination !== undefined || run.stderr !== '')
    return {
      harness: `unclean end: exit ${run.exitCode}${run.termination === undefined ? '' : `, ${run.termination}`}${run.stderr === '' ? '' : `, stderr ${JSON.stringify(run.stderr.slice(0, 300))}`}`,
      subtests: [],
    };
  const line = run.stdout.split('\n').find((l) => l.startsWith(REPORT));
  if (line === undefined)
    return {
      harness: `no report: exit ${run.exitCode}: ${(run.stderr || run.stdout).split('\n').slice(0, 3).join(' | ')}`,
      subtests: [],
    };
  const r = JSON.parse(line.slice(REPORT.length)) as {
    harness: number;
    results: { name: string; status: number; message: string | null }[];
  };
  return {
    harness: HARNESS[r.harness] ?? String(r.harness),
    subtests: r.results.map((t) => ({
      name: t.name,
      status: STATUS[t.status] ?? String(t.status),
      message: t.message,
    })),
  };
}

/** The file run by live Node (the oracle); throws on another Node version. */
export function inNode(file: string, timeoutMs = 120_000): Report {
  if (process.version !== WPT_NODE)
    throw new Error(`wpt oracle is Node ${WPT_NODE}, this is ${process.version}`);
  const dir = mkdtempSync(join(tmpdir(), 'rifty-wpt-'));
  try {
    writeFileSync(join(dir, 't.cjs'), file);
    const r = spawnSync(process.execPath, ['t.cjs'], {
      cwd: dir,
      env: {},
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 2 ** 20,
    });
    return parseReport({
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.status,
      ...(r.signal === null ? {} : { termination: r.signal }),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every way the guest's report differs from Node's, and an oracle that did not complete cleanly
 * (`harness` not `OK`, no subtest): the harness status, a subtest Node has and
 * the guest lacks (`missing`) or the reverse (`extra`), a status or message. `excluded` subtest
 * names are skipped; one that is not in Node's report or no longer differs is reported `stale`.
 */
export function differences(
  node: Report,
  guest: Report,
  excluded: readonly string[] = [],
): string[] {
  const out: string[] = [];
  if (node.harness !== 'OK' || node.subtests.length === 0)
    out.push(`oracle: Node ended ${node.harness} with ${node.subtests.length} subtests`);
  if (guest.harness !== node.harness)
    out.push(`harness: node ${node.harness}, guest ${guest.harness}`);
  const byName = (r: Report) => {
    const m = new Map<string, Subtest>();
    for (const t of r.subtests) {
      if (m.has(t.name)) out.push(`duplicate subtest name: ${t.name}`);
      m.set(t.name, t);
    }
    return m;
  };
  const want = byName(node);
  const got = byName(guest);
  const skip = new Set(excluded);
  for (const name of skip) {
    const n = want.get(name);
    const g = got.get(name);
    if (n === undefined) out.push(`stale exclusion (not in Node's report): ${name}`);
    else if (g !== undefined && g.status === n.status && g.message === n.message)
      out.push(`stale exclusion (now equal to Node): ${name}`);
  }
  for (const [name, n] of want) {
    if (skip.has(name)) continue;
    const g = got.get(name);
    if (g === undefined) out.push(`missing: ${name} (node ${n.status})`);
    else if (g.status !== n.status || g.message !== n.message)
      out.push(
        `${name}: node ${n.status} ${JSON.stringify(n.message)}, guest ${g.status} ${JSON.stringify(g.message)}`,
      );
  }
  for (const name of got.keys()) if (!want.has(name) && !skip.has(name)) out.push(`extra: ${name}`);
  return out;
}
