/**
 * The model-style `node -e` corpus (goal isolate-host-run-code I1), shared by
 * `runCode` parity and the custom-embedder parity of `@riftydev/isolate-guest`
 * (goal isolate-guest-embed I1). `parityView` is the one comparison: raw bytes,
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
   * A declared ceiling this row hits (compat ❌, ledger `re-cut:`): the row stays
   * literal and runs as an expected failure, so a fix turns it red until promoted.
   */
  readonly ceiling?: string;
}

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
    label: 'builtin-module-globals',
    code: "console.log(path.join('a', 'b'), typeof fs.readFileSync, util.format('%d', 1), path === require('path'), typeof crypto.createHash); path = 5; console.log(path)",
  },
  { label: 'throw-sync', code: "console.log('before'); throw new Error('boom')", evalError: true },
  { label: 'reject-unhandled', code: "Promise.reject(new Error('rej'))", evalError: true },
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
