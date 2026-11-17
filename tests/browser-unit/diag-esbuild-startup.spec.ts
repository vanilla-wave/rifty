// TEMPORARY diagnostic (ci-flake-hunt experiment PR #395): where the upstream
// esbuild-wasm `--service` startup spends 17-29 s on CI. Never merged.
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

// Child preload: timestamps every fs call / timer the Go wasm_exec runtime makes.
const TRACE = `const fs = require('node:fs');
const t0 = Date.now();
const out = (...a) => process.stderr.write('TRC ' + JSON.stringify([Date.now() - t0, ...a]) + '\\n');
out('preload', process.argv.slice(1));
const counts = {};
const slow = {};
for (const name of ['read', 'write', 'fstat', 'open', 'close', 'writeSync', 'readSync', 'fsync']) {
  const orig = fs[name];
  if (typeof orig !== 'function') continue;
  fs[name] = function (...args) {
    const k = name + ':' + args[0];
    const c = (counts[k] = (counts[k] || 0) + 1);
    const t = Date.now();
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      args[args.length - 1] = function (...r) {
        const dt = Date.now() - t;
        if (dt > 100) slow[k] = (slow[k] || 0) + dt;
        if (c <= 25 || c % 500 === 0 || dt > 100)
          out(name, args[0], c, dt, r[0] && (r[0].code || String(r[0])), typeof r[1] === 'number' ? r[1] : null);
        return cb.apply(this, r);
      };
    } else if (c <= 25 || c % 500 === 0) out(name + '(sync)', args[0], c);
    return orig.apply(this, args);
  };
}
let timers = 0;
let zero = 0;
const st = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms, ...rest) {
  timers++;
  if (!ms) zero++;
  if (timers <= 25 || timers % 1000 === 0) out('setTimeout', timers, ms);
  return st(fn, ms, ...rest);
};
for (const name of ['readFileSync', 'existsSync', 'statSync', 'realpathSync']) {
  const orig = fs[name];
  let c = 0;
  fs[name] = function (...args) {
    const t = Date.now();
    out(name + '-start', String(args[0]).slice(-60));
    try {
      return orig.apply(this, args);
    } finally {
      if (c++ < 40) out(name + '-end', String(args[0]).slice(-60), Date.now() - t);
    }
  };
}
const Mod = WebAssembly.Module;
WebAssembly.Module = function (...a) {
  out('module-start', a[0] && a[0].byteLength);
  const r = new Mod(...a);
  out('module-done');
  return r;
};
WebAssembly.Module.prototype = Mod.prototype;
for (const k of Object.getOwnPropertyNames(Mod)) if (!(k in WebAssembly.Module)) WebAssembly.Module[k] = Mod[k];
const M = require('node:module');
const load = M._load;
if (typeof load === 'function')
  M._load = function (request, ...rest) {
    const t = Date.now();
    try {
      return load.call(this, request, ...rest);
    } finally {
      out('require', request, Date.now() - t);
    }
  };
const envKeys = Object.keys(process.env).length;
out('env-keys', envKeys);
const Inst = WebAssembly.Instance;
WebAssembly.Instance = function (...a) {
  out('instance-start');
  const r = new Inst(...a);
  out('instance-done');
  return r;
};
WebAssembly.Instance.prototype = Inst.prototype;
const tick = () => {
  out('tick', { timers, zero, counts, slow });
  const h = st(tick, 2000);
  if (h && h.unref) h.unref();
};
tick();
process.on('exit', (code) => out('exit', code, { timers, zero, counts, slow }));
`;

// Parent: the real esbuild JS API; spawn tapped to add the preload and time the pipes.
const SERVICE = `const cp = require('node:child_process');
const path = require('node:path');
const t0 = Date.now();
const log = (...a) => console.log('SVC ' + JSON.stringify([Date.now() - t0, ...a]));
const spawn = cp.spawn;
cp.spawn = function (cmd, args, opts) {
  log('spawn', cmd, args);
  const child = spawn.call(this, cmd, [path.resolve('trace-wrap.cjs'), ...args], opts);
  let n = 0;
  child.stdout.on('data', (d) => { if (n++ < 30) log('child-stdout', d.length); });
  if (child.stderr) child.stderr.on('data', (d) => process.stdout.write(String(d)));
  const w = child.stdin.write.bind(child.stdin);
  let m = 0;
  child.stdin.write = (chunk, ...rest) => { if (m++ < 30) log('child-stdin-write', chunk.length); return w(chunk, ...rest); };
  child.on('exit', (code, sig) => log('child-exit', code, sig));
  return child;
};
const esbuild = require('esbuild');
log('required', esbuild.version);
esbuild.transform('let a = 1')
  .then(() => { log('transform1'); return esbuild.transform('let b = 2'); })
  .then(() => { log('transform2'); if (esbuild.stop) esbuild.stop(); log('stopped'); })
  .catch((e) => log('error', String(e && e.stack || e)));
`;

test('diag: esbuild-wasm --service startup trace (COI owner)', async ({ page }) => {
  test.setTimeout(900_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-diag-esbuild-service',
    persistence: 'ephemeral',
    plan: {
      kind: 'vite',
      id: 'scratch',
      starterId: 'vite-at-root',
      templateId: 'vite-at-root',
      files: {
        '/package.json': `${JSON.stringify({ name: 'diag', private: true, type: 'module', scripts: { dev: 'vite' }, dependencies: { react: '19.2.0', 'react-dom': '19.2.0' }, devDependencies: { vite: '7.3.6', '@vitejs/plugin-react': '5.2.0' } }, null, 2)}\n`,
        '/index.html': '<!doctype html><html><body><div id="root"></div></body></html>\n',
      },
      dependencies: { react: '19.2.0', 'react-dom': '19.2.0' },
      devDependencies: { vite: '7.3.6', '@vitejs/plugin-react': '5.2.0' },
      firstMaterialization: { kind: 'install' },
      port: 5174,
    },
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await writeOwnerFile(page, '/scratch/trace.cjs', TRACE);
    await writeOwnerFile(page, '/scratch/diag-service.cjs', SERVICE);
    await writeOwnerFile(
      page,
      '/scratch/trace-wrap.cjs',
      "require('./trace.cjs');\nprocess.argv.splice(1, 1);\nrequire(process.argv[1]);\n",
    );
    await writeOwnerFile(
      page,
      '/scratch/diag-read.cjs',
      "const t = Date.now();\nconst b = require('node:fs').readFileSync(require.resolve('esbuild-wasm/esbuild.wasm'));\nconsole.log('READ ' + JSON.stringify({ depth: process.env.DIAG_DEPTH || 'child', bytes: b.length, ms: Date.now() - t }));\n",
    );
    await writeOwnerFile(
      page,
      '/scratch/diag-read-nested.cjs',
      "require('node:child_process').spawn('node', ['diag-read.cjs'], { stdio: 'inherit', env: { ...process.env, DIAG_DEPTH: 'grandchild' } });\n",
    );
    for (let i = 0; i < 3; i += 1) {
      for (const line of ['node diag-read.cjs', 'node diag-read-nested.cjs']) {
        const r = await execLine(page, line);
        console.log(
          `[diag] depth ${i} ${r.out
            .split(/\r?\n/u)
            .filter((l) => l.startsWith('READ'))
            .join(' ')}`,
        );
      }
    }
    for (let i = 0; i < 2; i += 1) {
      const t = Date.now();
      const r = await execLine(page, 'node diag-service.cjs');
      console.log(`[diag] round ${i} wallMs=${Date.now() - t} exit=${r.exit}`);
      for (const line of r.out.split(/\r?\n/u)) if (line.trim()) console.log(`[diag] ${i} ${line}`);
    }
  } finally {
    await closeOwner(page);
  }
});
