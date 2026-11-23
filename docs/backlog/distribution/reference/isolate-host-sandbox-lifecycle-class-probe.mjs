import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * The sandbox's lifecycle class (ADR-0568, PR #424): each `runCode` lifecycle/status compat
 * row (docs/public/compat/isolate-host.md) as one `node p.js` program, run once in a sandbox
 * (`exec`) and once by live `node p.js` in a temp dir. Prints, per row: exit code (or the
 * termination) and the files left besides `p.js` (each program writes `a` first).
 * Run from the repo root after `pnpm --filter @riftydev/isolate-host build`:
 *   node docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class-probe.mjs
 */
const dist =
  process.argv[2] ?? new URL('../../../../packages/isolate-host/dist', import.meta.url).pathname;
const { createSandbox } = await import(`${dist}/index.js`);
const W = "const fs = require('fs'); const w = (n) => fs.writeFileSync(n, '1');";
const CASES = [
  ['uncopyable rejection reason', `${W} w('a'); Promise.reject(Object.create(null))`],
  ['unref() timer', `${W} let n = 0; setInterval(() => w('tick' + ++n), 1).unref()`],
  [
    'GC-lost rejection',
    `${W} w('a'); (() => { Promise.reject(new Error('x')) })(); const end = Date.now() + 30; let k = []; while (Date.now() < end) k.push({ a: [1, 2, 3] });`,
  ],
  [
    'work queued at exit()',
    `${W} queueMicrotask(() => w('late')); setTimeout(() => w('timer'), 0); w('a'); process.exit(3)`,
  ],
  [
    'exit() then endless queued work',
    `${W} w('a'); queueMicrotask(() => { for (;;) {} }); process.exit(3)`,
  ],
  [
    'exit() then queued work eating the heap',
    `${W} w('a'); queueMicrotask(() => { const k = []; for (;;) k.push(new Array(1e6).fill(1)) }); process.exit(3)`,
  ],
  [
    'exit listener work at a natural exit',
    `${W} w('a'); process.on('exit', () => { Promise.resolve().then(() => w('hop1')).then(() => w('hop2')) })`,
  ],
  [
    'exit listener sets exitCode in a microtask',
    `${W} w('a'); process.on('exit', () => { queueMicrotask(() => { process.exitCode = 4 }) })`,
  ],
  [
    'unhandled rejection with a timer pending',
    `${W} w('a'); Promise.reject(new Error('r')); setTimeout(() => { w('t'); process.exit(0) }, 0)`,
  ],
  [
    'intrinsic replaced (Reflect.get)',
    `${W} w('a'); Reflect.get = () => undefined; console.log(1)`,
  ],
  [
    'exit signal caught and mutated',
    `${W} w('a'); try { process.exit(3) } catch (e) { e.exitCode = 0 }`,
  ],
  [
    'work queued at an uncaught throw, exit(0) in a timer',
    `${W} w('a'); setTimeout(() => { w('q'); process.exit(0) }, 0); throw new Error('x')`,
  ],
  [
    'work queued at an uncaught throw, exit(0) in a microtask',
    `${W} w('a'); queueMicrotask(() => { w('q'); process.exit(0) }); throw new Error('x')`,
  ],
  [
    'work queued at an uncaught throw, exit(0) in an fs callback',
    `${W} w('a'); fs.writeFile('z', '1', () => { w('q'); process.exit(0) }); throw new Error('x')`,
  ],
  [
    'uncaught throw then an endless queued timer',
    `${W} w('a'); setTimeout(() => { for (;;) {} }, 0); throw new Error('x')`,
  ],
  [
    'uncaught throw + endless microtask chain',
    `${W} w('a'); const spin = () => Promise.resolve().then(spin); spin(); throw new Error('x')`,
  ],
  [
    'exitCode in an exit listener after an uncaught throw',
    `${W} w('a'); process.on('exit', () => { process.exitCode = 5 }); throw new Error('x')`,
  ],
  [
    'throw in an exit listener',
    `${W} w('a'); process.on('exit', () => { throw new Error('l') }); process.exit(3)`,
  ],
  [
    'rejection in an exit listener',
    `${W} w('a'); process.on('exit', () => { Promise.reject(new Error('r')) })`,
  ],
];
const files = (dir) =>
  readdirSync(dir)
    .filter((n) => n !== 'p.js')
    .sort()
    .join(',');
for (const [label, code] of CASES) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ct-')));
  writeFileSync(join(dir, 'p.js'), code);
  const n = spawnSync(process.execPath, ['p.js'], {
    cwd: dir,
    env: {},
    encoding: 'utf8',
    timeout: 20000,
  });
  const node = { exit: n.status, signal: n.signal, files: files(dir) };
  rmSync(dir, { recursive: true, force: true });
  const sb = await createSandbox();
  await sb.writeFile('p.js', code);
  const r = await sb.exec('p.js', { timeoutMs: 3000, memoryLimitMb: 128 });
  const list = (await sb.list())
    .map((e) => e.name)
    .filter((x) => x !== 'p.js')
    .sort()
    .join(',');
  await sb.destroy();
  const sandbox = {
    exit: r.exitCode,
    termination: r.termination,
    stateRefused: r.stateRefused,
    files: list,
  };
  console.log(JSON.stringify({ label, node, sandbox }));
}
process.exit(0);
