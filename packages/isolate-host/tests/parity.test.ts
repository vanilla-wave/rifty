/**
 * I1 — `runCode(code)` equals `node -e <code>` from this Node executable on the
 * model-style corpus (goal isolate-host-run-code, scenario step 2). Oracle is a
 * live child (`support.ts` nodeEval); stderr of error rows goes through the
 * existing node-cli-eval diagnostic canonicalization, everything else is exact.
 */
import { describe, expect, it } from 'vitest';
import { canonicalNodeCliEvalOutcome } from '../../../tools/node-parity-runner/src/node-cli-eval.ts';
import { runCode } from '../src/index.ts';
import { nodeEval } from './support.ts';

interface Row {
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

const CORPUS: readonly Row[] = [
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
    label: 'dynamic-import',
    code: "import('node:fs').then((m) => console.log(typeof m.readFileSync, typeof m.default.writeFileSync))",
    ceiling: 'import() in the isolate (ADR-0557 §5)',
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

describe('package surface (ADR-0557 §1)', () => {
  it("runCode is the package root's only runtime export", async () => {
    expect(Object.keys(await import('../src/index.ts'))).toEqual(['runCode']);
  });
});

describe('runCode parity with node -e (I1)', () => {
  for (const row of CORPUS) {
    const test = row.ceiling === undefined ? it : it.fails;
    test(row.ceiling === undefined
      ? row.label
      : `${row.label} — ceiling: ${row.ceiling}`, async () => {
      const invocation = {
        label: row.label,
        nodeArgv: ['-e', row.code],
        ...(row.evalError ? { evalErrorStderr: true } : {}),
      };
      const raw = nodeEval(row.code);
      expect(raw.signal, 'oracle must exit on its own').toBeNull();
      const result = await runCode(row.code);
      expect(result.termination).toBeUndefined();
      expect(result.truncated).toBeUndefined();
      // Raw bytes everywhere; only an uncaught-error row's stderr goes through the
      // node-cli-eval diagnostic projection (I1).
      const stderrOf = (stderr: string, code: number | null): string =>
        row.evalError
          ? canonicalNodeCliEvalOutcome(invocation, {
              stdout: '',
              stderr,
              frames: [],
              code,
              signal: null,
            }).stderr
          : stderr;
      expect({
        stdout: result.stdout,
        stderr: stderrOf(result.stderr, result.exitCode),
        exitCode: result.exitCode,
      }).toEqual({
        stdout: raw.stdout,
        stderr: stderrOf(raw.stderr, raw.code),
        exitCode: raw.code,
      });
    });
  }
});

/**
 * Declared ceilings (ADR-0557 §5; goal scenario step 4): real Node runs these;
 * the isolate host fails loudly with an error the model can act on.
 */
const CEILINGS: readonly { readonly api: string; readonly code: string }[] = [
  { api: 'URL', code: "console.log(new URL('https://a.b/c?d=1').searchParams.get('d'))" },
  { api: 'structuredClone', code: 'console.log(structuredClone({ a: [1] }))' },
];

describe('declared ceilings fail loudly (I1 ceilings, scenario step 4)', () => {
  for (const row of CEILINGS) {
    it(row.api, async () => {
      expect(nodeEval(row.code).code, 'real Node supports it').toBe(0);
      const result = await runCode(row.code);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(
        `NotImplementedError: Not implemented: isolate-host.${row.api} (not available in the rifty isolate host, ADR-0557)`,
      );
    });
  }

  it('every global and member of the closed ceiling list (ADR-0557 §5) throws its named gap', async () => {
    const globals = [
      'URL',
      'URLSearchParams',
      'structuredClone',
      'ReadableStream',
      'WritableStream',
      'TransformStream',
      'TextDecoderStream',
      'TextEncoderStream',
      'CompressionStream',
      'DecompressionStream',
      'AbortController',
      'AbortSignal',
      'EventTarget',
      'Event',
      'CustomEvent',
      'Blob',
      'File',
      'Request',
      'Response',
      'Headers',
      'FormData',
      'WebSocket',
      'MessageChannel',
      'MessagePort',
      'BroadcastChannel',
      'ReadableStreamDefaultReader',
      'ReadableStreamBYOBReader',
      'ReadableStreamBYOBRequest',
      'ReadableByteStreamController',
      'ReadableStreamDefaultController',
      'TransformStreamDefaultController',
      'WritableStreamDefaultWriter',
      'WritableStreamDefaultController',
      'ByteLengthQueuingStrategy',
      'CountQueuingStrategy',
      'CloseEvent',
      'MessageEvent',
      'URLPattern',
      'Crypto',
      'CryptoKey',
      'SubtleCrypto',
      'Navigator',
      'Performance',
      'PerformanceEntry',
      'PerformanceMark',
      'PerformanceMeasure',
      'PerformanceObserver',
      'PerformanceObserverEntryList',
      'PerformanceResourceTiming',
    ];
    const members = [
      'crypto.subtle',
      'performance.mark',
      'performance.measure',
      'performance.getEntries',
      'performance.getEntriesByName',
      'performance.getEntriesByType',
      'performance.clearMarks',
      'performance.clearMeasures',
      'performance.eventLoopUtilization',
      'performance.timerify',
      'performance.nodeTiming',
      'navigator.hardwareConcurrency',
      'navigator.language',
      'navigator.languages',
      'navigator.platform',
      'navigator.userAgent',
    ];
    const result = await runCode(`
      const out = [];
      const named = (label, e) => out.push(label + '=' + (e && e.name === 'NotImplementedError' && e.message.startsWith('Not implemented: isolate-host.' + label + ' ') ? 'loud' : 'WRONG ' + (e && e.message)));
      for (const g of ${JSON.stringify(globals)}) {
        try { new globalThis[g](); out.push(g + '=WRONG constructed'); } catch (e) { named(g, e); }
      }
      for (const m of ${JSON.stringify(members)}) {
        const [o, k] = m.split('.');
        try { const v = globalThis[o][k]; if (typeof v === 'function') v(); out.push(m + '=WRONG returned'); } catch (e) { named(m, e); }
      }
      fetch('http://example.com/').then(() => out.push('fetch=WRONG resolved'), (e) => named('fetch', e))
        .then(() => console.log(out.join('\\n')));
    `);
    const expected = [...globals, ...members, 'fetch'].map((n) => `${n}=loud`).join('\n');
    expect(result).toEqual({ stdout: `${expected}\n`, stderr: '', exitCode: 0 });
  });

  for (const code of [
    "await Promise.resolve(); console.log('tla')",
    "import fs from 'node:fs'; console.log(typeof fs.readFileSync)",
  ]) {
    it(`ESM syntax in -e: ${code}`, async () => {
      expect(nodeEval(code).code, 'real Node supports it').toBe(0);
      const result = await runCode(code);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'NotImplementedError: Not implemented: isolate-host.node-eval-esm (Node runs -e input with ESM syntax as a module; this host evaluates CommonJS only — use require())',
      );
    });
  }

  it('every global node -e defines exists in the guest (live oracle list)', async () => {
    const list = 'console.log(JSON.stringify(Object.getOwnPropertyNames(globalThis).sort()))';
    const nodeNames = JSON.parse(nodeEval(list).stdout) as string[];
    const guest = await runCode(list);
    const guestNames = new Set(JSON.parse(guest.stdout) as string[]);
    expect(nodeNames.filter((name) => !guestNames.has(name))).toEqual([]);
  });

  for (const code of [
    "import('nonexistent-pkg')",
    "setTimeout(() => import('nonexistent-pkg'), 20)",
    "setImmediate(() => import('nonexistent-pkg'))",
    "Promise.resolve().then(() => import('nonexistent-pkg'))",
  ]) {
    it(`an unhandled import() fails loudly, as Node fails a missing module: ${code}`, async () => {
      expect(nodeEval(code).code).toBe(1);
      const result = await runCode(code);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'Error: Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)',
      );
      // The rejection is made in the child: none of its frames (host paths) reach the guest.
      expect(result.stderr).not.toMatch(/child\.js|importModuleDynamically/);
    });
  }

  // The import() rejection lands while the guest's process is alive: its events and
  // exit status follow Node (stdout + status; Node's stderr is ERR_MODULE_NOT_FOUND).
  for (const code of [
    "process.on('unhandledRejection', (r) => console.log('UR', typeof r)); import('nonexistent-pkg')",
    "process.on('uncaughtException', (e, o) => console.log('UE', o)); import('nonexistent-pkg')",
    "process.on('exit', (c) => console.log('exit', c)); import('nonexistent-pkg')",
    "import('nonexistent-pkg'); process.exit(0)",
    "setTimeout(() => import('nonexistent-pkg').catch(() => console.log('caught')), 5)",
  ]) {
    it(`process events around a failing import() follow Node: ${code}`, async () => {
      const oracle = nodeEval(code);
      const result = await runCode(code);
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({
        stdout: oracle.stdout,
        exitCode: oracle.code,
      });
    });
  }

  // A handler attached in a later task: Node has already reported the import()
  // rejection unhandled → status 1. (The late handler's own output still runs here:
  // the declared rejection-timing ⚠️, compat isolate-host.md.)
  for (const code of [
    "const p = import('nonexistent-pkg'); setTimeout(() => p.catch(() => console.log('late')))",
    "const p = import('nonexistent-pkg'); setTimeout(() => p.catch(() => console.log('late')), 2)",
    "const p = import('nonexistent-pkg'); setImmediate(async () => { try { await p } catch { console.log('late') } })",
  ]) {
    it(`an import() rejection handled only in a later task still fails the run: ${code}`, async () => {
      expect(nodeEval(code).code).toBe(1);
      expect((await runCode(code)).exitCode).toBe(1);
    });
  }

  // A rejection reason isolated-vm cannot copy out (function-bearing object, symbol)
  // still fails the run, as Node does (stdout + status; Node's stderr wording differs).
  for (const code of [
    'Promise.reject({ f() {} })',
    'Promise.reject(Symbol())',
    'Promise.reject(1)',
  ]) {
    it(`uncopyable unhandled rejection reasons fail the run: ${code}`, async () => {
      const oracle = nodeEval(code);
      const result = await runCode(code);
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({
        stdout: oracle.stdout,
        exitCode: oracle.code,
      });
    });
  }

  for (const [api, code] of [
    ['zlib', "require('zlib').gzip('x', () => {})"],
    ['child_process', "require('child_process').execSync('ls')"],
    ['worker_threads', "new (require('worker_threads').Worker)('1', { eval: true })"],
  ] as const) {
    it(`host-specific ceilings name their own API: ${api}`, async () => {
      const result = await runCode(code);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`NotImplementedError: Not implemented: isolate-host.${api} `);
    });
  }

  it('import() rejects with a named gap', async () => {
    const result = await runCode(
      "import('node:fs').then(() => console.log('LOADED'), (e) => console.log(e.message))",
    );
    expect(result).toEqual({
      stdout:
        'Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)\n',
      stderr: '',
      exitCode: 0,
    });
  });

  it('fetch', async () => {
    const result = await runCode("fetch('http://example.com/').then((r) => console.log(r.status))");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'NotImplementedError: Not implemented: isolate-host.fetch (not available in the rifty isolate host, ADR-0557)',
    );
  });
});
