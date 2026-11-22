/**
 * The model-style `node -e` corpus (ADR-0557 §1), shared by
 * `runCode` parity and the custom-embedder parity of `@riftydev/isolate-guest`
 * (ADR-0558 §6). `parityView` is the one comparison: raw bytes,
 * except an uncaught-error row's stderr goes through the node-cli-eval
 * diagnostic projection.
 */
import { canonicalNodeCliEvalOutcome } from '../../../tools/node-parity-runner/src/node-cli-eval.ts';

export interface Row {
  readonly label: string;
  readonly code: string;
  /** Uncaught error: compare the canonical `[eval]` diagnostic, not internal frames. */
  readonly evalError?: true;
  /**
   * A declared ceiling this row hits (compat ❌ or ⚠️): the row stays
   * literal and runs as an expected failure, so a fix turns it red until promoted.
   */
  readonly ceiling?: string;
}

/**
 * Garbage enough to force several scavenges in any young generation isolated-vm sizes
 * (≤16 MiB). Stored to a global so it escapes: an optimized loop drops non-escaping
 * allocations, and when it tiers up depends on load (no GC → the report survives).
 */
export const GC_CHURN = 'for (let i = 0; i < 2e6; i++) globalThis.gcChurn = { i };';

export const CORPUS: readonly Row[] = [
  {
    label: 'console-log-values',
    code: "console.log(1 + 1, 'a', { b: [1, { c: 2 }] }, [1, 2, 3], null, undefined, true, 1.5, -0, 10n)",
  },
  {
    label: 'console-format',
    code: "console.log('%s is %d (%j)', 'x', 5, { a: 1 }); console.info('info')",
  },
  {
    label: 'stdout-write-bytes',
    code: "process.stdout.write('x'); process.stdout.write(Buffer.from([0x79])); process.stdout.write(new Uint8Array([0x7a]))",
  },
  { label: 'stdout-utf8', code: "process.stdout.write('é€😀\\n'); console.log('ünï')" },
  {
    label: 'stderr-console',
    code: "console.error('err', 42); console.warn('warn'); process.stderr.write('raw')",
  },
  {
    label: 'interleaved-streams',
    code: "console.log('out1'); console.error('err1'); console.log('out2')",
  },
  { label: 'exit-code', code: "process.exitCode = 3; console.log('set')" },
  { label: 'exit-explicit', code: "console.log('a'); process.exit(7); console.log('b')" },
  {
    label: 'exit-event',
    code: "process.on('exit', (c) => console.log('exit', c)); console.log('body')",
  },
  {
    label: 'event-loop-order',
    code: "setTimeout(() => console.log('t200'), 200); setTimeout(() => console.log('t100'), 100); setImmediate(() => console.log('immediate')); Promise.resolve().then(() => console.log('micro')); queueMicrotask(() => console.log('qm')); process.nextTick(() => console.log('tick')); console.log('sync')",
  },
  {
    label: 'async-await',
    code: "(async () => { await new Promise((r) => setTimeout(r, 10)); console.log('awaited'); return 1 })().then((v) => console.log('then', v))",
  },
  {
    label: 'interval-cleared',
    code: 'let n = 0; const t = setInterval(() => { n++; if (n === 3) { clearInterval(t); console.log(n) } }, 2)',
  },
  {
    label: 'fs-roundtrip',
    code: "const fs = require('fs'); fs.mkdirSync('out/deep', { recursive: true }); fs.writeFileSync('out/a.txt', 'hello'); fs.appendFileSync('out/a.txt', ' world'); fs.writeFileSync('out/b.bin', Buffer.from([0, 255, 1])); console.log(fs.readFileSync('out/a.txt', 'utf8'), fs.readdirSync('out').sort(), fs.existsSync('nope'), fs.readFileSync('out/b.bin'), fs.statSync('out/a.txt').size, fs.statSync('out').isDirectory())",
  },
  {
    label: 'fs-promises',
    code: "const fsp = require('fs/promises'); (async () => { await fsp.writeFile('p.json', JSON.stringify({ k: [1, 2] })); const j = JSON.parse(await fsp.readFile('p.json', 'utf8')); console.log(j.k.length) })()",
  },
  {
    label: 'fs-enoent',
    code: "try { require('fs').readFileSync('missing.txt') } catch (e) { console.log(e.code, e.syscall, e.errno) }",
  },
  {
    label: 'buffer',
    code: "const b = Buffer.from('hello'); console.log(b.toString('base64'), b.toString('hex'), Buffer.concat([b, Buffer.from('!')]).toString(), b, b.length, Buffer.byteLength('é'), Buffer.from('aGk=', 'base64').toString())",
  },
  {
    label: 'path-util',
    code: "const path = require('node:path'); const util = require('util'); console.log(path.join('/a', '../b', 'c.txt'), path.extname('x.tar.gz'), path.basename('/q/w.e', '.e'), util.format('%s=%d', 'n', 5), util.inspect(new Map([[1, { a: [1, 2] }]])), util.inspect(new Set(['x'])), util.isDeepStrictEqual({ a: 1 }, { a: 1 }))",
  },
  {
    label: 'crypto-hash',
    code: "const crypto = require('crypto'); console.log(crypto.createHash('sha256').update('abc').digest('hex'), crypto.createHash('md5').update('abc').digest('base64'), crypto.createHmac('sha1', 'k').update('d').digest('hex'))",
  },
  {
    label: 'events',
    code: "const EventEmitter = require('events'); const e = new EventEmitter(); e.once('x', (v) => console.log('got', v)); console.log(e.emit('x', 1), e.emit('x', 2), e.listenerCount('x'))",
  },
  {
    label: 'cjs-scope',
    code: 'console.log(typeof require, typeof module, typeof exports, __filename, typeof __dirname, this === module.exports, require.main === undefined)',
  },
  {
    label: 'compute',
    code: "let s = 0; for (let i = 0; i < 1e6; i++) s += i; console.log(s, [3, 1, 2].sort(), Math.max(...[3, 9, 2]), 'abc'.padStart(6, '*'), new Date(0).toISOString(), JSON.stringify({ a: [1, { b: null }] }, null, 2))",
  },
  {
    label: 'text-codec',
    code: "const enc = new TextEncoder().encode('añ€😀'); console.log(enc, new TextDecoder().decode(enc), new TextDecoder().decode(new Uint8Array([0xff, 0x61])))",
    ceiling:
      'util.inspect: typed-array header and >6-element grouping (runtime-js/util-surface-completions)',
  },
  {
    label: 'base64-globals',
    code: "console.log(btoa('hello'), atob('aGVsbG8='))",
  },
  {
    label: 'esm-top-level-await',
    code: "await Promise.resolve(); console.log('tla', typeof require)",
    ceiling: 'node -e ESM syntax detection (runtime-js/node-cli-esm-eval-context)',
  },
  {
    label: 'esm-static-import',
    code: "import fs from 'node:fs'; import { join } from 'node:path'; fs.writeFileSync('m.txt', 'esm'); console.log(fs.readFileSync(join('.', 'm.txt'), 'utf8'))",
    ceiling: 'node -e ESM syntax detection (runtime-js/node-cli-esm-eval-context)',
  },
  {
    // Kept literal: Node loads the module; here `import()` ends the run (ADR-0557 §5).
    label: 'dynamic-import',
    code: "import('node:fs').then((m) => console.log(typeof m.readFileSync, typeof m.default.writeFileSync))",
    ceiling: 'import() ends the run (ADR-0557 §5)',
  },
  {
    label: 'timer-delay-coercion',
    code: "for (const d of [1n, Symbol('s')]) { try { setTimeout(() => {}, d); console.log('ran') } catch (e) { console.log(e.name + ': ' + e.message) } } setTimeout(() => console.log('string delay'), '5')",
  },
  {
    // Kept literal: Node also prints a TimeoutOverflowWarning on stderr.
    label: 'timer-delay-out-of-range',
    code: "setTimeout(() => console.log('t'), 2 ** 31); const t = setInterval(() => { console.log('i'); clearInterval(t) }, 3e9)",
    ceiling: 'Timeout*Warning (runtime-js/timeout-delay-warnings)',
  },
  {
    // Node re-arms an interval after its callback ran: ticks never pile up
    // (backlog distribution/isolate-host-timer-fire-backpressure).
    label: 'slow-interval-keeps-pace',
    code: 'let n = 0; const t0 = Date.now(); const iv = setInterval(() => { n++; const e = Date.now() + 10; while (Date.now() < e); }, 1); setTimeout(() => { clearInterval(iv); console.log(Date.now() - t0 < 3000, n < 150) }, 1000)',
  },
  {
    // Node re-arms from the tick's start: a 150 ms callback every 200 ms starts ~200 ms apart
    // (re-arming from its end: ~350). Gaps, not counts: a loaded machine stretches both alike.
    label: 'interval-keeps-its-period',
    code: 'const s = []; const iv = setInterval(() => { s.push(Date.now()); if (s.length === 4) { clearInterval(iv); const g = [s[2] - s[1], s[3] - s[2]].sort((a, b) => a - b); console.log(g[0] < 275) } const e = Date.now() + 150; while (Date.now() < e); }, 200)',
  },
  {
    // Never early: Node's `setInterval(f, 10)` averages ≥ 10 ms between ticks (~11.5 here).
    label: 'interval-never-early',
    code: 'const t = []; let p = performance.now(); const iv = setInterval(() => { const n = performance.now(); t.push(n - p); p = n; if (t.length === 20) { clearInterval(iv); console.log(t.slice(1).reduce((a, b) => a + b) / 19 >= 9.8) } }, 10)',
  },
  {
    label: 'interval-storm',
    code: "let n = 0; const ts = []; for (let i = 0; i < 20000; i++) ts.push(setInterval(() => { n++ }, 1)); setTimeout(() => { ts.forEach(clearInterval); console.log('done', n > 0) }, 1000)",
  },
  {
    label: 'builtin-module-globals',
    code: "console.log(path.join('a', 'b'), typeof fs.readFileSync, util.format('%d', 1), path === require('path'), typeof crypto.createHash); path = 5; console.log(path)",
  },
  { label: 'throw-sync', code: "console.log('before'); throw new Error('boom')", evalError: true },
  { label: 'reject-unhandled', code: "Promise.reject(new Error('rej'))", evalError: true },
  // Each promise origin, rejected unhandled, then a GC forced by allocation in the
  // same task (no clock): isolated-vm drops the report (compat ⚠️). 0 reports in
  // 320 runs each, 16 concurrent under CPU load (2026-11-19).
  ...Object.entries({
    'reject-then-gc': "Promise.reject(new Error('rej'));",
    'reject-new-promise-then-gc': "new Promise((_, r) => r(new Error('rej')));",
    'reject-async-fn-then-gc': "(async () => { throw new Error('rej') })();",
    'reject-in-timer-then-gc': "setTimeout(() => { Promise.reject(new Error('rej')); ALLOC }, 1);",
  }).map(
    ([label, head]): Row => ({
      label,
      code: head.includes('ALLOC') ? head.replace('ALLOC', GC_CHURN) : `${head} ${GC_CHURN}`,
      evalError: true,
      ceiling:
        'isolated-vm drops an unhandled rejection a GC collects before its task ends (distribution/isolate-host-unhandled-rejection-lost-to-gc)',
    }),
  ),
  // A handled rejection survives the GC (the compat workaround: `parity.test.ts`).
  {
    label: 'reject-caught-then-gc',
    code: `Promise.reject(new Error('rej')).catch(() => console.log('caught')); ${GC_CHURN}`,
  },
  {
    // The workaround's twin for both lanes (`parity.test.ts` runs the compat snippet
    // verbatim on runCode; `e.message` here because rifty's stack frames differ).
    label: 'reject-caught-exit-code-then-gc',
    code: `(async () => { throw new Error('rej') })().catch((e) => { console.error(e.message); process.exitCode = 1 }); ${GC_CHURN}`,
  },
  {
    // Exit 0 in 160/160 runs, 16 concurrent under load: the run's status is fixed before the report arrives.
    label: 'reject-in-exit-listener',
    code: "process.on('exit', () => { Promise.reject(new Error('rej')) })",
    evalError: true,
    ceiling:
      'a rejection inside an exit listener exits 0 (distribution/isolate-host-rejection-in-exit-listener-exits-0)',
  },
  // A terminal from work the synchronous run queued, before any later task.
  { label: 'exit-in-then', code: 'Promise.resolve().then(() => process.exit(3))' },
  {
    label: 'exit-after-async-main',
    code: "async function main() { console.log('work') } main().then(() => process.exit(0))",
  },
  {
    label: 'exit-in-catch',
    code: "Promise.reject(new Error('x')).catch(() => process.exit(1))",
  },
  { label: 'exit-in-finally', code: 'Promise.resolve().finally(() => process.exit(4))' },
  { label: 'exit-in-queue-microtask', code: 'queueMicrotask(() => process.exit(3))' },
  {
    label: 'exit-in-nested-microtasks',
    code: 'Promise.resolve().then(() => Promise.resolve().then(() => queueMicrotask(() => process.exit(5))))',
  },
  {
    label: 'exit-in-microtask-with-pending-timers',
    code: "setTimeout(() => console.log('timer'), 0); setInterval(() => console.log('interval'), 1); setImmediate(() => console.log('immediate')); Promise.resolve().then(() => process.exit(2))",
  },
  {
    label: 'exit-in-microtask-after-output',
    code: "process.on('exit', (c) => console.log('exit', c)); console.log('before'); console.error('err'); Promise.resolve().then(() => { process.exit(6); console.log('after-exit') })",
  },
  {
    label: 'exit-in-microtask-exit-code',
    code: 'process.exitCode = 9; Promise.resolve().then(() => process.exit())',
  },
  {
    label: 'exit-in-microtask-skips-queued-microtask',
    code: "Promise.resolve().then(() => process.exit(0)); Promise.resolve().then(() => console.log('queued'))",
  },
  {
    label: 'exit-in-next-tick',
    code: "process.nextTick(() => process.exit(4)); process.nextTick(() => console.log('queued'))",
  },
  {
    label: 'throw-in-queue-microtask',
    code: "queueMicrotask(() => { throw new Error('qm') })",
    evalError: true,
  },
  {
    label: 'throw-primitive-in-queue-microtask',
    code: 'queueMicrotask(() => { throw 1 })',
    evalError: true,
  },
  {
    label: 'throw-in-timer',
    code: "setTimeout(() => { throw new Error('late') }, 1)",
    evalError: true,
  },
  {
    label: 'type-error',
    code: 'const o = undefined; o.x',
    evalError: true,
    ceiling:
      'node -e diagnostic header for a non-throw error (runtime-js/node-eval-non-throw-diagnostic-header)',
  },
  {
    label: 'uncaught-handler',
    code: "process.on('uncaughtException', (e) => { console.log('caught', e.message); process.exitCode = 4 }); setTimeout(() => { throw new Error('handled') }, 1)",
  },
];

export interface Outcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/** What a run and its oracle are compared on, for `row`. */
export function parityView(row: Row, outcome: Outcome): Outcome {
  const invocation = {
    label: row.label,
    nodeArgv: ['-e', row.code],
    ...(row.evalError ? { evalErrorStderr: true } : {}),
  };
  const stderr = row.evalError
    ? canonicalNodeCliEvalOutcome(invocation, {
        stdout: '',
        stderr: outcome.stderr,
        frames: [],
        code: outcome.exitCode,
        signal: null,
      }).stderr
    : outcome.stderr;
  return { stdout: outcome.stdout, stderr, exitCode: outcome.exitCode };
}
