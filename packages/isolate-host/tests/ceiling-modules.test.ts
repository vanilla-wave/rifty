/**
 * `node:zlib`, `node:child_process`, `node:worker_threads` in the isolate guest (unit
 * `backlog/distribution/isolate-host-ceiling-modules-load`, ADR-0557 §6 correction
 * 2026-11-24): Node's shape and real members, against live `node`; every use of the
 * missing compression engine, processes or workers a named gap at use, never at load.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCode } from '../src/index.ts';
import { nodeEval, nodeSequence } from './support.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/ceiling/${name}`, import.meta.url), 'utf8');

/**
 * Declared shape deviations (unit §Out of scope): a loud-constructed class keeps Node's
 * chain but none of its own prototype members; rifty's `Readable` (every host) extends
 * `EventEmitter` directly, without Node's legacy `Stream` between them
 * (`backlog/runtime-js/stream-classes-skip-legacy-stream`).
 */
const LOUD_CONSTRUCTED = [
  'child_process.ChildProcess value',
  'worker_threads.Worker value',
  'base ~Zlib ',
  'base ~ZlibBase ',
];
const declared = (line: string): string =>
  (LOUD_CONSTRUCTED.some((p) => line.startsWith(p))
    ? line.replace(/ protoOwn=\S+/, ' protoOwn=constructor')
    : line
  ).replace(/>Readable(\.prototype)?>Stream\1>/g, '>Readable$1>');

describe('module shape equals live node -e (Acceptance 1)', () => {
  it('zlib, child_process, worker_threads: names, descriptors, kinds, chains, identities, data', async () => {
    const code = fixture('shape.cjs');
    const oracle = nodeEval(code);
    expect(oracle.code, oracle.stderr).toBe(0);
    const result = await runCode(code);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(oracle.stdout.split('\n').map(declared).join('\n'));
    expect(result.exitCode).toBe(0);
  });
});

describe('real members equal live node -e (Acceptance 2)', () => {
  it('environment data, read-only tables, promisify forms, port and LockManager errors, chains through Object.create', async () => {
    const code = fixture('behaviour.cjs');
    const oracle = nodeEval(code);
    expect(oracle.code, oracle.stderr).toBe(0);
    const result = await runCode(code);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(oracle.stdout);
    expect(result.exitCode).toBe(0);
  });
});

const ONE_SHOTS = [
  'deflate',
  'gzip',
  'deflateRaw',
  'unzip',
  'inflate',
  'gunzip',
  'inflateRaw',
  'brotliCompress',
  'brotliDecompress',
  'zstdCompress',
  'zstdDecompress',
];
const STREAMS = [
  'Deflate',
  'Inflate',
  'DeflateRaw',
  'InflateRaw',
  'Gzip',
  'Gunzip',
  'Unzip',
  'BrotliCompress',
  'BrotliDecompress',
  'ZstdCompress',
  'ZstdDecompress',
];

/** [what the guest does, the feature its gap names]. */
const LOUD: readonly (readonly [string, string])[] = [
  ["zlib.crc32('x')", 'zlib.crc32'],
  ...ONE_SHOTS.flatMap((f) => [
    [`zlib.${f}(Buffer.from('x'), () => {})`, `zlib.${f}`] as const,
    [`zlib.${f}Sync(Buffer.from('x'))`, `zlib.${f}Sync`] as const,
  ]),
  ...STREAMS.flatMap((c) => [
    [`zlib.create${c}()`, `zlib.create${c}`] as const,
    [`new zlib.${c}()`, `zlib.${c}`] as const,
    [`new (class extends zlib.${c} {})()`, `zlib.${c}`] as const,
  ]),
  ['zlib.Gzip()', 'zlib.Gzip'],
  ['zlib.DeflateRaw({})', 'zlib.DeflateRaw'],
  // crc32-stream 6: `class DeflateCRC32Stream extends zlib.DeflateRaw` + `super(options)`.
  ['new (class extends zlib.DeflateRaw { constructor(o) { super(o) } })({})', 'zlib.DeflateRaw'],
  ['function G() { zlib.Gzip.call(this) } util.inherits(G, zlib.Gzip); new G()', 'zlib.Gzip'],
  ['new (Object.getPrototypeOf(zlib.Gzip))()', 'zlib.Zlib'],
  ['new (Object.getPrototypeOf(Object.getPrototypeOf(zlib.Gzip)))()', 'zlib.ZlibBase'],
  ['new (Object.getPrototypeOf(zlib.BrotliCompress))()', 'zlib.Brotli'],
  ['new (Object.getPrototypeOf(zlib.ZstdCompress))()', 'zlib.Zstd'],
  ['child_process._forkChild(3)', 'child_process._forkChild'],
  ["child_process.exec('ls', () => {})", 'child_process.exec'],
  ["child_process.execFile('ls', [], () => {})", 'child_process.execFile'],
  ["child_process.execFileSync('ls')", 'child_process.execFileSync'],
  ["child_process.execSync('ls')", 'child_process.execSync'],
  ["child_process.fork('m.js')", 'child_process.fork'],
  ["child_process.spawn('ls')", 'child_process.spawn'],
  ["child_process.spawnSync('ls')", 'child_process.spawnSync'],
  ["util.promisify(child_process.exec)('ls')", 'child_process.exec'],
  ["util.promisify(child_process.execFile)('ls')", 'child_process.execFile'],
  ['new child_process.ChildProcess()', 'child_process.ChildProcess'],
  ['child_process.ChildProcess()', 'child_process.ChildProcess'],
  ['new (class extends child_process.ChildProcess {})()', 'child_process.ChildProcess'],
  [
    'function C() { child_process.ChildProcess.call(this) } util.inherits(C, child_process.ChildProcess); new C()',
    'child_process.ChildProcess',
  ],
  ["new worker_threads.Worker('1', { eval: true })", 'worker_threads.Worker'],
  ["new (class extends worker_threads.Worker {})('1', { eval: true })", 'worker_threads.Worker'],
  ['worker_threads.markAsUncloneable({})', 'worker_threads.markAsUncloneable'],
  [
    'worker_threads.markAsUntransferable(new ArrayBuffer(1))',
    'worker_threads.markAsUntransferable',
  ],
  [
    'worker_threads.isMarkedAsUntransferable(new ArrayBuffer(1))',
    'worker_threads.isMarkedAsUntransferable',
  ],
  // The guest's web globals, the same objects: their own gap.
  ['new worker_threads.MessageChannel()', 'MessageChannel'],
  ['new worker_threads.MessagePort()', 'MessagePort'],
  ["new worker_threads.BroadcastChannel('c')", 'BroadcastChannel'],
];

/** Node's `async` members: the gap is the rejection. */
const LOUD_ASYNC: readonly (readonly [string, string])[] = [
  ["worker_threads.postMessageToThread(1, 'x')", 'worker_threads.postMessageToThread'],
  ["worker_threads.locks.request('l', () => {})", 'worker_threads.locks.request'],
  ['worker_threads.locks.query()', 'worker_threads.locks.query'],
];

const ARGS = "'zlib', 'child_process', 'worker_threads', 'util'";
const MODS =
  "require('zlib'), require('child_process'), require('worker_threads'), require('util')";

describe('engine, process and worker use is a named gap; load, reads and subclassing are not (Acceptance 3)', () => {
  it('require, import(), every property read, a spread and every subclass declaration throw nothing', async () => {
    const code = `
      const mods = { zlib: require('zlib'), child_process: require('child_process'), worker_threads: require('worker_threads') };
      const seen = [];
      for (const [m, mod] of Object.entries(mods)) {
        const copy = { ...mod };
        for (const k of Object.getOwnPropertyNames(mod)) {
          const v = mod[k];
          if (typeof v === 'function' && v.prototype) { class Sub extends v {} seen.push(m + '.' + Sub.name); }
        }
        seen.push(m + ' ' + Object.keys(copy).length);
      }
      Promise.all(['node:zlib', 'node:child_process', 'node:worker_threads'].map((s) => import(s)))
        .then(() => console.log('loaded', seen.join(',')));`;
    const [oracle] = nodeSequence([{ files: { 'load.cjs': code }, run: ['load.cjs'] }]);
    expect(oracle?.stdout).toMatch(/^loaded .+\n$/);
    const sb = await createSandbox();
    try {
      await sb.writeFile('load.cjs', code);
      expect(await sb.exec('load.cjs')).toEqual({
        stdout: oracle?.stdout,
        stderr: '',
        exitCode: 0,
      });
    } finally {
      await sb.destroy();
    }
  });

  it('each member that needs an engine, a process or a worker throws NotImplementedError naming itself, at use', async () => {
    const result = await runCode(`
      const out = [];
      for (const [expr, feature] of ${JSON.stringify(LOUD)}) {
        try { new Function(${ARGS}, expr)(${MODS}); out.push(expr + ' REACHED'); }
        catch (e) {
          const ok = e instanceof Error && e.name === 'NotImplementedError' &&
            e.message.startsWith('Not implemented: isolate-host.' + feature + ' (');
          out.push(expr + ' ' + (ok ? 'loud' : 'WRONG ' + e.name + ': ' + e.message));
        }
      }
      console.log(out.join('\\n'));`);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${LOUD.map(([expr]) => `${expr} loud`).join('\n')}\n`);
  });

  it("each async member returns a promise that rejects with its gap, as Node's errors reject", async () => {
    const result = await runCode(`
      (async () => {
        const out = [];
        for (const [expr, feature] of ${JSON.stringify(LOUD_ASYNC)}) {
          let p;
          try { p = new Function(${ARGS}, 'return ' + expr)(${MODS}); }
          catch (e) { out.push(expr + ' SYNC ' + e.message); continue; }
          if (!(p instanceof Promise)) { out.push(expr + ' NOT A PROMISE'); continue; }
          try { await p; out.push(expr + ' RESOLVED'); }
          catch (e) {
            const ok = e instanceof Error && e.name === 'NotImplementedError' &&
              e.message.startsWith('Not implemented: isolate-host.' + feature + ' (');
            out.push(expr + ' ' + (ok ? 'rejects' : 'WRONG ' + e.name + ': ' + e.message));
          }
        }
        console.log(out.join('\\n'));
      })();`);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${LOUD_ASYNC.map(([expr]) => `${expr} rejects`).join('\n')}\n`);
  });

  it('an uncaught gap fails the run as Node fails on an uncaught error', async () => {
    const result = await runCode("require('zlib').gzipSync('x')");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'NotImplementedError: Not implemented: isolate-host.zlib.gzipSync (',
    );
  });
});

describe('import() from CommonJS and node -e globals (Acceptance 5)', () => {
  it('namespace keys and default identity equal node <file>', async () => {
    const code = `const ids = ['zlib', 'child_process', 'worker_threads'];
      Promise.all(ids.map((id) => import('node:' + id))).then((nss) => console.log(nss
        .map((ns, i) => ids[i] + ' ' + Object.keys(ns).sort().join(',') + ' ' + (ns.default === require(ids[i])))
        .join('\\n')));`;
    const [oracle] = nodeSequence([{ files: { 'ns.cjs': code }, run: ['ns.cjs'] }]);
    const sb = await createSandbox();
    try {
      await sb.writeFile('ns.cjs', code);
      expect(await sb.exec('ns.cjs')).toEqual({
        stdout: oracle?.stdout,
        stderr: '',
        exitCode: 0,
      });
    } finally {
      await sb.destroy();
    }
  });

  it('the lazy zlib/child_process/worker_threads globals are the required modules', async () => {
    const code =
      "console.log(zlib === require('zlib'), child_process === require('node:child_process'), worker_threads === require('worker_threads'), zlib.constants.Z_BEST_COMPRESSION, worker_threads.isMainThread)";
    const oracle = nodeEval(code);
    expect(await runCode(code)).toEqual({
      stdout: oracle.stdout,
      stderr: oracle.stderr,
      exitCode: oracle.code,
    });
  });
});
