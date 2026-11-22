/**
 * I1 — `runCode(code)` equals `node -e <code>` from this Node executable on the
 * model-style corpus (goal isolate-host-run-code, scenario step 2). Oracle is a
 * live child (`support.ts` nodeEval); stderr of error rows goes through the
 * existing node-cli-eval diagnostic canonicalization, everything else is exact.
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { CORPUS, GC_CHURN, parityView } from './corpus.ts';
import { nodeEval } from './support.ts';

describe('package surface (ADR-0557 §1)', () => {
  it('the package root exports runCode and createSandbox only (ADR-0568)', async () => {
    expect(Object.keys(await import('../src/index.ts')).sort()).toEqual([
      'createSandbox',
      'runCode',
    ]);
  });
});

describe.each([undefined, true])(
  'runCode parity with node -e (allowSharedArrayBuffer=%s)',
  (allowSharedArrayBuffer) => {
    for (const row of CORPUS) {
      const test = row.ceiling === undefined ? it : it.fails;
      test(row.ceiling === undefined
        ? row.label
        : `${row.label} — ceiling: ${row.ceiling}`, async () => {
        const raw = nodeEval(row.code);
        expect(raw.signal, 'oracle must exit on its own').toBeNull();
        const options =
          allowSharedArrayBuffer === undefined ? undefined : { allowSharedArrayBuffer };
        const result = await runCode(row.code, options);
        expect(result.termination).toBeUndefined();
        expect(result.truncated).toBeUndefined();
        expect(parityView(row, result)).toEqual(
          parityView(row, { stdout: raw.stdout, stderr: raw.stderr, exitCode: raw.code }),
        );
      });
    }
  },
);

/** Declared gaps pinned to what they do today: a fix turns them red (compat ⚠️ rows). */
describe('declared gaps and their workarounds (compat ⚠️)', () => {
  it('the documented workaround for a GC-lost rejection: a .catch that reports and sets exitCode', async () => {
    // Exactly the snippet of the compat row and the README.
    const code = `(async () => { throw new Error('rej') })().catch((e) => { console.error(e); process.exitCode = 1 }); ${GC_CHURN}`;
    const raw = nodeEval(code);
    const result = await runCode(code);
    expect(raw.code).toBe(1);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(raw.stdout);
    // The frames below are rifty's (`at eval ([eval]:1:22)`, guest-bundle frames), not Node's.
    expect(result.stderr.split('\n')[0]).toBe('Error: rej');
    expect(raw.stderr.split('\n')[0]).toBe('Error: rej');
  });

  it('process.exit() from a microtask of the synchronous run ends as timeout (Node exits with its code)', async () => {
    // Nothing ends such a run: `timeout` in 160/160 runs, 16 concurrent under load.
    const code = 'Promise.resolve().then(() => process.exit(3))';
    expect(nodeEval(code).code).toBe(3);
    const result = await runCode(code, { timeoutMs: 2000 });
    expect(result.termination).toBe('timeout');
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('Error: process exit requires an active control port');
  });
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

  // `import()` is a gap this host cannot serve and whose rejection the guest may
  // never observe. Every form therefore ends the run loudly (exit 1 + the named
  // gap on stderr), keeping whatever the run printed first. No form exits 0.
  for (const code of [
    "import('node:fs')",
    "(async () => { const fs = await import('node:fs'); console.log('read') })()",
    'eval("import(\'node:fs\')")',
    'new Function("return import(\'node:fs\')")()',
    "import('node:fs').then(() => console.log('LOADED'), () => console.log('caught'))",
    "import('node:fs').catch(() => {}); process.exit(0)",
    "setTimeout(() => import('node:fs'), 5)",
    "console.log('before'); import('nope')",
  ]) {
    it(`import() ends the run loudly: ${code}`, async () => {
      const result = await runCode(code);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'Error: Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)',
      );
      // Output the run produced before the gap is kept.
      if (code.startsWith("console.log('before')")) expect(result.stdout).toBe('before\n');
      expect(result.stderr).not.toMatch(/child\.js|dist\/|file:/);
    });
  }

  it('fetch', async () => {
    const result = await runCode("fetch('http://example.com/').then((r) => console.log(r.status))");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'NotImplementedError: Not implemented: isolate-host.fetch (not available in the rifty isolate host, ADR-0557)',
    );
  });
});

describe('timer delays Node clamps to 1 ms (2^31 and above, negative, NaN)', () => {
  // The output and status are Node's; Node's `Timeout*Warning` on stderr is the
  // declared gap (`timer-delay-out-of-range` ceiling row).
  for (const delay of ['2 ** 31', '1e10', '-5', 'NaN']) {
    it(delay, async () => {
      const code = `setTimeout(() => console.log('t'), ${delay})`;
      const oracle = nodeEval(code);
      const result = await runCode(code);
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({
        stdout: oracle.stdout,
        exitCode: oracle.code,
      });
      expect(result.stderr).toBe('');
    });
  }
});

describe('declared: an exit() already queued overrides a pending fatal', () => {
  // `backlog/runtime-js/node-eval-queued-exit-overrides-pending-fatal`: Node
  // exits 1 with the report; a runtime fix turns these red until promoted.
  for (const code of [
    "setTimeout(() => { throw new Error('x') }); setTimeout(() => process.exit(0))",
    "setTimeout(() => { queueMicrotask(() => process.exit(0)); throw new Error('x') })",
    "Promise.reject(new Error('x')); setTimeout(() => process.exit(0))",
  ]) {
    it(code, async () => {
      expect(nodeEval(code).code, 'Node fails it').toBe(1);
      expect(await runCode(code)).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    });
  }
});
