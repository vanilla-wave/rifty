// PDF text-extraction probe for the rifty isolate host. Same script under real `node` (oracle) and
// in `createSandbox().exec()`; the library's files sit at /node_modules of the sandbox.
// Method copied from docs/backlog/distribution/reference/isolate-library-probe/probe.mjs.
//
//   node probe.mjs <rifty checkout> [--json out.json] [--no-trace] [case…]
//
// A case is scripts/gen/<name>.(cjs|mjs) + the top-level packages it needs (CASES below).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2);
const repo = argv.shift();
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const bool = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const jsonOut = flag('--json');
const depsDir = flag('--deps') ?? join(root, 'deps');
const noTrace = bool('--no-trace');
const hostDist = join(repo, 'packages/isolate-host/dist');
const { createSandbox } = await import(pathToFileURL(join(hostDist, 'index.js')).href);
const codec = await import(pathToFileURL(join(hostDist, 'codec.js')).href);
const MiB = 1 << 20;

// name → { entry, pkgs: top-level node_modules dirs laid into the sandbox, extra: extra files }
const P = {
  pdfparse1: ['pdf-parse-v1', 'debug', 'ms', 'node-ensure'],
  pdfparse2: ['pdf-parse', '@napi-rs'],
  pdfjs3: ['pdfjs-dist-v3'],
  pdfjs: ['pdfjs-dist'],
  unpdf: ['unpdf'],
  pdf2json: ['pdf2json'],
  pdfreader: ['pdfreader'],
  pdfjsextract: ['pdf.js-extract', 'dommatrix'],
  mupdf: ['mupdf'],
  pdfium: ['@hyzyla'],
};
const CASES = {};
for (const f of readdirSync(join(here, 'gen')).sort()) {
  if (f.startsWith('_')) continue;
  const name = f.replace(/\.(cjs|mjs)$/, '');
  const kind = name.split('-')[0];
  if (!P[kind]) throw new Error(`no package set for ${f}`);
  CASES[f] = {
    entry: f,
    pkgs: [...P[kind], ...(f.includes('polyfill') ? ['web-streams-polyfill'] : [])],
  };
}
const wanted = argv.length ? argv : Object.keys(CASES);
const PDFS = readdirSync(join(root, 'pdfs'))
  .filter((f) => f.endsWith('.pdf'))
  .sort();

// node_modules subset → MemoryFsSync at /node_modules → snapshot (cached per package set).
const states = new Map();
const stateFor = (pkgs) => {
  const key = pkgs.join(',');
  if (states.has(key)) return states.get(key);
  const fs = new codec.MemoryFsSync();
  for (const dir of codec.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  let files = 0;
  let bytes = 0;
  let nativeFiles = 0;
  const walk = (abs, guest) => {
    fs.mkdirSync(guest, { recursive: true });
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const g = `${guest}/${name}`;
      const st = lstatSync(a);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(a, g);
      else {
        const data = readFileSync(a);
        fs.writeFileSync(g, data);
        files += 1;
        bytes += data.byteLength;
        if (name.endsWith('.node')) nativeFiles += 1;
      }
    }
  };
  for (const p of pkgs) walk(join(depsDir, 'node_modules', p), `/node_modules/${p}`);
  const fits = (maxBytes) => {
    try {
      return codec.snapshotFs(fs, { template: null, maxBytes });
    } catch {
      return undefined;
    }
  };
  let lo = 0;
  let hi = 1024 * MiB;
  while (hi - lo > 64 * 1024) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const snapshot = fits(hi);
  const maxFsBytes = Math.ceil((hi + 16 * MiB) / MiB) * MiB;
  const state = {
    key,
    snapshot,
    files,
    bytes,
    nativeFiles,
    maxFsBytes,
    memoryLimitMb: Math.max(256, 2 * (maxFsBytes / MiB) + 96),
  };
  // Oracle dir: real copies of the same packages (APFS clones), so Node sees the same tree.
  const oracle = join(root, 'oracle', key.replace(/[^a-z0-9.-]+/gi, '_'));
  rmSync(oracle, { recursive: true, force: true });
  mkdirSync(join(oracle, 'node_modules'), { recursive: true });
  for (const p of pkgs) {
    mkdirSync(dirname(join(oracle, 'node_modules', p)), { recursive: true });
    execFileSync('cp', ['-cR', join(depsDir, 'node_modules', p), join(oracle, 'node_modules', p)]);
  }
  execFileSync('cp', ['-R', join(here, 'gen'), join(oracle, 'gen')]);
  execFileSync('cp', ['-R', join(root, 'pdfs'), join(oracle, 'pdfs')]);
  if (existsSync(join(root, 'bundles')))
    execFileSync('cp', ['-R', join(root, 'bundles'), join(oracle, 'bundles')]);
  state.oracle = oracle;
  states.set(key, state);
  return state;
};

const head = (s, n = 1800) => (s.length > n ? `${s.slice(0, n)}…[+${s.length - n}]` : s);
// Drop over-long lines (a minified bundle echoed in a stack header).
const clean = (s) =>
  s
    .split('\n')
    .map((l) => (l.length > 400 ? `${l.slice(0, 200)}…[line of ${l.length}]` : l))
    .join('\n');
const results = [];
for (const name of wanted) {
  const c = CASES[name];
  if (!c) throw new Error(`unknown case ${name}`);
  const st = stateFor(c.pkgs);
  const sandbox = await createSandbox({
    snapshot: st.snapshot,
    maxFsBytes: st.maxFsBytes,
    maxFileBytes: 32 * MiB,
  });
  for (const f of readdirSync(join(here, 'gen')))
    await sandbox.writeFile(`gen/${f}`, readFileSync(join(here, 'gen', f)));
  for (const f of PDFS) await sandbox.writeFile(`pdfs/${f}`, readFileSync(join(root, 'pdfs', f)));
  if (existsSync(join(root, 'bundles')))
    for (const f of readdirSync(join(root, 'bundles')))
      await sandbox.writeFile(`bundles/${f}`, readFileSync(join(root, 'bundles', f)));
  const r = {
    case: name,
    pkgs: c.pkgs,
    tree: { files: st.files, bytes: st.bytes, nativeFiles: st.nativeFiles },
    memoryLimitMb: st.memoryLimitMb,
    runs: [],
  };
  // One run per PDF, then all PDFs in one process.
  for (const files of [...PDFS.map((f) => [f]), PDFS]) {
    const args = files.map((f) => `pdfs/${f}`);
    const tn = performance.now();
    const node = spawnSync('node', [`gen/${c.entry}`, ...args], {
      cwd: st.oracle,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const nodeMs = Math.round(performance.now() - tn);
    const te = performance.now();
    let guest;
    try {
      guest = await sandbox.exec(`gen/${c.entry}`, {
        args,
        memoryLimitMb: st.memoryLimitMb,
        timeoutMs: 120_000,
      });
    } catch (e) {
      guest = { exitCode: null, stdout: '', stderr: `exec rejected: ${e.code}: ${e.message}` };
    }
    const guestMs = Math.round(performance.now() - te);
    const equal = node.status === 0 && guest.exitCode === 0 && node.stdout === guest.stdout;
    r.runs.push({
      nodeStdoutFull: node.stdout,
      guestStdoutSha: createHash('sha256').update(guest.stdout).digest('hex'),
      files,
      node: {
        exitCode: node.status,
        ms: nodeMs,
        stdout: head(node.stdout),
        stderr: head(clean(node.stderr)),
      },
      guest: {
        exitCode: guest.exitCode,
        termination: guest.termination,
        stateRefused: guest.stateRefused,
        ms: guestMs,
        stdout: head(guest.stdout),
        stderr: head(clean(guest.stderr), 3000),
      },
      verdict: equal
        ? 'EQUAL'
        : node.status !== 0
          ? 'NODE-FAILS'
          : guest.exitCode === 0
            ? 'DIFFERS'
            : 'GUEST-STOPS',
    });
  }
  if (!noTrace) {
    const traced = spawnSync(
      'node',
      ['-r', join(here, 'trace.cjs'), `gen/${c.entry}`, ...PDFS.map((f) => `pdfs/${f}`)],
      {
        cwd: st.oracle,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 64 * MiB,
      },
    );
    const line = traced.stderr.split('\n').find((l) => l.startsWith('TRACE '));
    r.trace = line ? JSON.parse(line.slice(6)) : { error: head(clean(traced.stderr)) };
    r.traceExit = traced.status;
  }
  // The all-files run against the per-file oracle runs joined (a library that fails under node
  // only when several files share a process still has a per-file oracle).
  const perFile = r.runs
    .filter((x) => x.files.length === 1)
    .map((x) => x.nodeStdoutFull)
    .join('');
  const all = r.runs.find((x) => x.files.length > 1);
  r.allRunGuestEqualsPerFileNode =
    all.guestStdoutSha === createHash('sha256').update(perFile).digest('hex');
  // biome-ignore lint/performance/noDelete: drops the field from the JSON
  for (const x of r.runs) delete x.nodeStdoutFull;
  await sandbox.destroy();
  results.push(r);
  console.log(
    `\n=== ${name}  [${c.pkgs.join(', ')}] tree ${st.files} files ${(st.bytes / MiB).toFixed(1)} MiB, memoryLimitMb ${st.memoryLimitMb}`,
  );
  console.log(
    `  all-files guest stdout == per-file node stdouts joined: ${r.allRunGuestEqualsPerFileNode}`,
  );
  for (const run of r.runs) {
    console.log(
      `  ${run.verdict.padEnd(11)} ${run.files.join('+')}  node exit ${run.node.exitCode} ${run.node.ms}ms | guest exit ${run.guest.exitCode}${run.guest.termination ? ` (${run.guest.termination})` : ''}${run.guest.stateRefused ? ` stateRefused ${run.guest.stateRefused}` : ''} ${run.guest.ms}ms`,
    );
    if (run.verdict !== 'EQUAL') {
      if (run.node.exitCode !== 0)
        console.log(
          `    node stderr: ${run.node.stderr.split('\n').filter(Boolean).slice(0, 6).join('\n                 ')}`,
        );
      console.log(
        `    guest stderr: ${run.guest.stderr.split('\n').filter(Boolean).slice(0, 14).join('\n                  ')}`,
      );
      if (run.verdict === 'DIFFERS')
        console.log(
          `    node stdout:  ${run.node.stdout.slice(0, 500)}\n    guest stdout: ${run.guest.stdout.slice(0, 500)}`,
        );
    }
  }
}
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
