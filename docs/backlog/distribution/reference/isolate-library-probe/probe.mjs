// Library probe: can pptxgenjs / pdf-lib / docx / exceljs write a valid document inside an
// isolate-host sandbox today? The four libraries' node_modules are laid out in rifty's FS in the
// consumer realm, snapshotted with the codec and handed to `createSandbox({ snapshot })` — a
// stand-in for the missing template (`NotImplementedError('isolate-host.sandbox-template')`),
// probe only. Each generator in gen/ runs in the sandbox and under real `node` over the same
// files (the oracle); verify/verify.cjs checks both outputs in real Node.
//
// From the repo root, after `pnpm install && pnpm --filter @riftydev/isolate-host build`:
//   node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs [--json out.json] [--min-memory] [--keep] [--deps-artifact a.tar.gz] [name…]
// Installs deps/ and verify/ with `npm ci` into a temp dir (network: the npm registry only).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const hostDist = join(here, '../../../../../packages/isolate-host/dist');
const { createSandbox } = await import(pathToFileURL(join(hostDist, 'index.js')).href);
const codec = await import(pathToFileURL(join(hostDist, 'codec.js')).href);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const jsonOut = flag('--json');
// node_modules from a produceDependencySnapshot artifact (tar.gz) instead of `npm ci` of deps/.
const artifact = flag('--deps-artifact');
const keep = argv.includes('--keep') && argv.splice(argv.indexOf('--keep'), 1); // keep the temp dir (outputs)
const minMemory = argv.includes('--min-memory') && argv.splice(argv.indexOf('--min-memory'), 1);
const LIBS = { pptx: 'pptxgenjs', pdf: 'pdf-lib', docx: 'docx', xlsx: 'exceljs' };
// A name is gen/<name>.cjs; its kind (verifier, package) is the part before '-': pptx-handled → pptx.
const libs = argv.length
  ? argv
  : readdirSync(join(here, 'gen'))
      .filter((f) => f.endsWith('.cjs'))
      .map((f) => f.slice(0, -4))
      .sort();
const kindOf = (name) => name.split('-')[0];
const MiB = 1 << 20;

// 1. npm ci both manifests into a temp dir.
const work = mkdtempSync(join(tmpdir(), 'isolate-library-probe-'));
const install = (name) => {
  const dir = join(work, name);
  cpSync(join(here, name, 'package.json'), join(dir, 'package.json'));
  cpSync(join(here, name, 'package-lock.json'), join(dir, 'package-lock.json'));
  execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], {
    cwd: dir,
    stdio: 'ignore',
  });
  return dir;
};
let deps;
if (artifact) {
  deps = join(work, 'artifact');
  mkdirSync(deps);
  execFileSync('tar', ['-xzf', artifact, '-C', deps, 'payload']);
  deps = join(deps, 'payload');
} else deps = install('deps');
const verifyDir = install('verify');
cpSync(join(here, 'verify/verify.cjs'), join(verifyDir, 'verify.cjs'));
const versions = Object.fromEntries(
  Object.values(LIBS).map((p) => [
    p,
    JSON.parse(readFileSync(join(deps, 'node_modules', p, 'package.json'))).version,
  ]),
);

// 2. node_modules → rifty's FS at /workspace/node_modules, in the consumer realm.
const fs = new codec.MemoryFsSync();
for (const dir of codec.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
let files = 0;
let bytes = 0;
const skipped = [];
const walk = (abs, guest) => {
  fs.mkdirSync(guest, { recursive: true });
  for (const name of readdirSync(abs).sort()) {
    const a = join(abs, name);
    const g = `${guest}/${name}`;
    const st = lstatSync(a);
    if (st.isSymbolicLink())
      skipped.push(g); // npm's .bin links: rifty's FS has none (ADR-0050)
    else if (st.isDirectory()) walk(a, g);
    else {
      const data = readFileSync(a);
      fs.writeFileSync(g, data);
      files += 1;
      bytes += data.byteLength;
    }
  }
};
walk(join(deps, 'node_modules'), '/workspace/node_modules');
// Smallest maxBytes the codec accepts for this tree (its budget units, ADR-0567).
const fits = (maxBytes) => {
  try {
    return codec.snapshotFs(fs, { template: null, maxBytes });
  } catch {
    return undefined;
  }
};
let lo = 0;
let hi = 1024 * MiB;
while (hi - lo > 1024) {
  const mid = Math.floor((lo + hi) / 2);
  if (fits(mid)) hi = mid;
  else lo = mid;
}
const t0 = performance.now();
const snapshot = fits(hi);
const snapshotMs = performance.now() - t0;
const snapshotGzipBytes = gzipSync(snapshot).byteLength; // the host compresses (ADR-0567)
const maxFsBytes = Math.ceil((hi + 16 * MiB) / MiB) * MiB; // room for the run's own files
const memoryLimitMb = 2 * (maxFsBytes / MiB) + 64;
const base = {
  versions,
  files,
  bytes,
  skippedLinks: skipped.length,
  budget: hi,
  snapshotBytes: snapshot.byteLength,
  snapshotGzipBytes,
  snapshotMs: Math.round(snapshotMs),
  maxFsBytes,
  memoryLimitMb,
};
console.log(JSON.stringify(base));

const tc = performance.now();
const sandbox = await createSandbox({ snapshot, maxFsBytes, maxFileBytes: 32 * MiB });
const createMs = Math.round(performance.now() - tc);

// 3. Oracle: real node over the same node_modules.
const oracle = join(work, 'oracle');
mkdirSync(join(oracle, 'gen'), { recursive: true });
mkdirSync(join(oracle, 'out'));
symlinkSync(join(deps, 'node_modules'), join(oracle, 'node_modules'));

const verify = (file, kind, other) => {
  try {
    return JSON.parse(
      execFileSync('node', ['verify.cjs', kind, file, ...(other ? [other] : [])], {
        cwd: verifyDir,
        encoding: 'utf8',
      }),
    );
  } catch (e) {
    return { ok: false, error: String(e.stdout || e.message).slice(0, 2000) };
  }
};

const results = [];
for (const lib of libs) {
  const gen = readFileSync(join(here, 'gen', `${lib}.cjs`));
  const outRel = `out/probe-${lib}.${kindOf(lib)}`;
  // Oracle.
  writeFileSync(join(oracle, 'gen', `${lib}.cjs`), gen);
  let nodeRun;
  const tn = performance.now();
  try {
    nodeRun = {
      exitCode: 0,
      stdout: execFileSync('node', [`gen/${lib}.cjs`, outRel], {
        cwd: oracle,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (e) {
    nodeRun = { exitCode: e.status, stdout: e.stdout, stderr: e.stderr };
  }
  nodeRun.ms = Math.round(performance.now() - tn); // process start included
  // The same run under trace.cjs: builtins loaded (with their require chains) and web globals read.
  const traced = spawnSync(
    'node',
    ['-r', join(here, 'trace.cjs'), `gen/${lib}.cjs`, `out/trace-${lib}.${kindOf(lib)}`],
    { cwd: oracle, encoding: 'utf8' },
  );
  const traceLine = traced.stderr.split('\n').find((l) => l.startsWith('TRACE '));
  nodeRun.trace = traceLine
    ? JSON.parse(traceLine.slice(6))
    : { error: traced.stderr.slice(0, 2000) };
  // Sandbox.
  await sandbox.writeFile(`gen/${lib}.cjs`, gen);
  await sandbox.writeFile('out/.keep', '');
  const te = performance.now();
  const run = await sandbox.exec(`gen/${lib}.cjs`, {
    args: [outRel],
    memoryLimitMb,
    timeoutMs: 120_000,
  });
  const execMs = Math.round(performance.now() - te);
  if (kindOf(lib) === 'diag') {
    // Lines that differ from real node's: what the guest lacks along the libraries' paths.
    const nodeLines = nodeRun.stdout.trim().split('\n');
    const guestLines = run.stdout.trim().split('\n');
    const r = {
      lib,
      exitCode: run.exitCode,
      nodeExitCode: nodeRun.exitCode,
      differs: guestLines.filter((l) => !nodeLines.includes(l)),
      nodeOnly: nodeLines.filter((l) => !guestLines.includes(l)),
      stderr: run.stderr,
      trace: nodeRun.trace,
    };
    results.push(r);
    console.log(JSON.stringify(r, null, 1));
    continue;
  }
  const nodeVerdict =
    nodeRun.exitCode === 0 ? verify(join(oracle, outRel), kindOf(lib)) : { ok: false };
  let guestVerdict = { ok: false };
  let outBytes;
  if (run.exitCode === 0 && !run.stateRefused) {
    try {
      const out = await sandbox.readFile(outRel);
      outBytes = out.byteLength;
      const f = join(work, `guest-${lib}.${kindOf(lib)}`);
      writeFileSync(f, out);
      guestVerdict = verify(f, kindOf(lib));
      if (nodeRun.exitCode === 0) guestVerdict.vsNode = verify(join(oracle, outRel), 'diff', f);
    } catch (e) {
      guestVerdict = { ok: false, error: `${e.code}: ${e.message}` };
    }
  }
  const r = {
    lib,
    pkg: LIBS[kindOf(lib)],
    version: versions[LIBS[kindOf(lib)]],
    node: {
      exitCode: nodeRun.exitCode,
      ms: nodeRun.ms,
      verdict: nodeVerdict,
      trace: nodeRun.trace,
    },
    guest: { ...run, execMs, outBytes, verdict: guestVerdict },
  };
  results.push(r);
  console.log(JSON.stringify(r, null, 1));
}

// 4. Warm exec latency on this state (a no-op file) and the smallest memoryLimitMb a run fits in.
await sandbox.writeFile('noop.cjs', '');
const lat = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  await sandbox.exec('noop.cjs', { memoryLimitMb, timeoutMs: 120_000 });
  lat.push(performance.now() - t);
}
lat.sort((a, b) => a - b);
// The same no-op on an empty sandbox: what the state adds.
const empty = await createSandbox();
await empty.writeFile('noop.cjs', '');
const latEmpty = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  await empty.exec('noop.cjs');
  latEmpty.push(performance.now() - t);
}
await empty.destroy();
latEmpty.sort((a, b) => a - b);
const measures = {
  createMs,
  noopExecMedianMs: Math.round(lat[2]),
  emptySandboxNoopExecMedianMs: Math.round(latEmpty[2]),
};
// Where a template could mount: does require() from /workspace reach /node_modules (Node walks to /)?
await sandbox.writeFile('/node_modules/probe-root-pkg/index.js', 'module.exports = 42;');
await sandbox.writeFile('root.cjs', "console.log(require('probe-root-pkg'))");
const root = await sandbox.exec('root.cjs', { memoryLimitMb, timeoutMs: 120_000 });
measures.rootNodeModules = root.exitCode === 0 ? root.stdout.trim() : root.stderr.split('\n')[0];
await sandbox.remove('/node_modules');
if (minMemory) {
  const okAt = async (mb, file) => {
    const r = await sandbox.exec(file, {
      memoryLimitMb: mb,
      timeoutMs: 120_000,
      args: ['out/min'],
    });
    return r.exitCode === 0 && !r.stateRefused;
  };
  for (const file of [
    'noop.cjs',
    ...libs
      .filter((l) => results.find((r) => r.lib === l)?.guest?.verdict.ok)
      .map((l) => `gen/${l}.cjs`),
  ]) {
    let a = 16; // fails
    let b = memoryLimitMb; // fits
    if (!(await okAt(b, file))) continue;
    while (b - a > 4) {
      const m = Math.floor((a + b) / 2);
      if (await okAt(m, file)) b = m;
      else a = m;
    }
    measures[`minMemoryLimitMb:${file}`] = b;
  }
}
console.log(JSON.stringify(measures));
await sandbox.destroy();
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ base, measures, results }, null, 2)}\n`);
if (keep) console.log(`kept ${work}`);
else rmSync(work, { recursive: true, force: true });
