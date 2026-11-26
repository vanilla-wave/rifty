// Chain walk: run chain/<case>.cjs in the sandbox, read the first stop, replace that one global with
// a script-side ponyfill (chain/_stubs.cjs, PROBE ONLY), run again — until the text equals Node's or
// a stop has no ponyfill. Oracle: the same script under real node with no stubs.
//   node chain.mjs <rifty checkout> [--json out.json] <case> [initial,stubs]
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2);
const repo = argv.shift();
let jsonOut;
if (argv[0] === '--json') {
  argv.shift();
  jsonOut = argv.shift();
}
const [name, initial = ''] = argv;
const { createSandbox } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/dist/index.js')).href
);
const codec = await import(pathToFileURL(join(repo, 'packages/isolate-host/dist/codec.js')).href);
const MiB = 1 << 20;
const PONY = [
  'core-js-pure',
  'web-streams-polyfill',
  'abort-controller',
  'event-target-shim',
  'dommatrix',
];
const PKGS = {
  pdfjs3: ['pdfjs-dist-v3'],
  pdfparse2: ['pdf-parse', '@napi-rs'],
  pdfjs6bundle: [],
  unpdfbundle: [],
};
const pkgs = [...PKGS[name], ...PONY];
const PDFS = readdirSync(join(root, 'pdfs'))
  .filter((f) => f.endsWith('.pdf'))
  .sort();
const fs = new codec.MemoryFsSync();
for (const dir of codec.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
const walk = (abs, guest) => {
  fs.mkdirSync(guest, { recursive: true });
  for (const n of readdirSync(abs).sort()) {
    const st = lstatSync(join(abs, n));
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(join(abs, n), `${guest}/${n}`);
    else fs.writeFileSync(`${guest}/${n}`, readFileSync(join(abs, n)));
  }
};
for (const p of pkgs) walk(join(root, 'deps/node_modules', p), `/node_modules/${p}`);
walk(join(here, 'chain'), '/workspace/chain');
walk(join(root, 'bundles'), '/workspace/bundles');
walk(join(root, 'pdfs'), '/workspace/pdfs');
let hi = 64 * MiB;
let snapshot;
for (;;) {
  try {
    snapshot = codec.snapshotFs(fs, { template: null, maxBytes: hi });
    break;
  } catch {
    hi *= 2;
  }
}
const maxFsBytes = hi + 16 * MiB;
const memoryLimitMb = Math.max(256, 2 * (maxFsBytes / MiB) + 96);
const sandbox = await createSandbox({ snapshot, maxFsBytes, maxFileBytes: 32 * MiB });
// Oracle tree.
const oracle = join(root, 'oracle', `chain-${name}`);
rmSync(oracle, { recursive: true, force: true });
mkdirSync(join(oracle, 'node_modules'), { recursive: true });
for (const p of pkgs)
  execFileSync('cp', ['-cR', join(root, 'deps/node_modules', p), join(oracle, 'node_modules', p)]);
for (const d of ['pdfs', 'bundles']) execFileSync('cp', ['-R', join(root, d), join(oracle, d)]);
execFileSync('cp', ['-R', join(here, 'chain'), join(oracle, 'chain')]);
const args = PDFS.map((f) => `pdfs/${f}`);
const node = spawnSync('node', [`chain/${name}.cjs`, '-', ...args], {
  cwd: oracle,
  encoding: 'utf8',
  timeout: 120000,
  maxBuffer: 64 * MiB,
});
const short = (s) =>
  s.split('\n').map((l) => (l.length > 300 ? `${l.slice(0, 160)}…[line of ${l.length}]` : l));
console.log(
  `# ${name}: node (no stubs) exit ${node.status}${
    node.status
      ? `\n  node stderr: ${short(node.stderr)
          .filter((l) => l && !/^\s+at /.test(l))
          .slice(0, 6)
          .join(' ⏎ ')}`
      : ''
  }`,
);
const MAP = [
  [/isolate-host\.(URLSearchParams)\b/, 'URLSearchParams'],
  [/isolate-host\.(URL)\b/, 'URL'],
  [/isolate-host\.structuredClone/, 'structuredClone'],
  [/isolate-host\.(ReadableStream|WritableStream|TransformStream)/, 'ReadableStream'],
  [/isolate-host\.(AbortController|AbortSignal|EventTarget)/, 'AbortController'],
  [/isolate-host\.DecompressionStream/, 'noDecompressionStream'],
  [/isolate-host\.MessageChannel/, 'MessageChannel'],
  [/getBuiltinModule is not a function/, 'getBuiltinModule'],
  [/DOMMatrix is not defined/, 'DOMMatrix'],
];
const stubs = initial ? initial.split(',') : [];
const steps = [];
for (let i = 0; i < 14; i++) {
  let g;
  try {
    g = await sandbox.exec(`chain/${name}.cjs`, {
      args: [stubs.join(',') || '-', ...args],
      memoryLimitMb,
      timeoutMs: 120000,
    });
  } catch (e) {
    g = { exitCode: null, stdout: '', stderr: `exec rejected ${e.code}: ${e.message}` };
  }
  const lines = short(g.stderr).filter(Boolean);
  const err = lines
    .filter((l) => !/^\s+at /.test(l))
    .slice(0, 5)
    .join(' ⏎ ');
  const frames = lines
    .filter((l) => /^\s+at /.test(l) && !l.includes('rifty-isolate-guest.js'))
    .slice(0, 4)
    .map((l) => l.trim());
  const json = (t) =>
    t
      .split('\n')
      .filter((l) => l.startsWith('{"file"'))
      .join('\n'); // pdf.js prints its warnings on stdout
  const equal =
    g.exitCode === 0 &&
    node.status === 0 &&
    json(g.stdout) !== '' &&
    json(g.stdout) === json(node.stdout);
  const step = {
    stdoutNoise: g.stdout
      .split('\n')
      .filter((l) => l && !l.startsWith('{"file"'))
      .slice(0, 12),
    stubs: [...stubs],
    exitCode: g.exitCode,
    termination: g.termination,
    stateRefused: g.stateRefused,
    equalToNode: equal,
    error: err,
    frames,
    stdoutHead: g.stdout.slice(0, 300),
    stderrAll: lines.slice(0, 40),
  };
  steps.push(step);
  console.log(
    `\nstep ${i + 1} stubs [${stubs.join(', ') || 'none'}] → guest exit ${g.exitCode}${g.termination ? ` ${g.termination}` : ''}${equal ? '  TEXT = NODE' : ''}`,
  );
  if (!equal) {
    console.log(`  error: ${err.slice(0, 900)}\n  frames: ${frames.join(' < ').slice(0, 700)}`);
    if (g.exitCode === 0)
      console.log(
        `  guest stdout: ${g.stdout.slice(0, 600)}\n  node stdout:  ${node.stdout.slice(0, 600)}`,
      );
  } else {
    if (err) console.log(`  guest stderr (run still passes): ${err.slice(0, 600)}`);
    if (step.stdoutNoise.length)
      console.log(
        `  guest stdout, non-result lines: ${step.stdoutNoise.join(' ⏎ ').slice(0, 700)}`,
      );
    break;
  }
  const hit = MAP.find(([re, s]) => re.test(g.stderr) && !stubs.includes(s));
  if (!hit) {
    console.log('  no ponyfill for this stop — chain ends here');
    break;
  }
  stubs.push(hit[1]);
}
// Minimal set: drop each ponyfill in turn, keep it out when the text still equals Node's.
const last = steps[steps.length - 1];
let minimal;
if (last.equalToNode) {
  minimal = [...last.stubs];
  for (const s of [...minimal]) {
    const trial = minimal.filter((x) => x !== s);
    const g = await sandbox.exec(`chain/${name}.cjs`, {
      args: [trial.join(',') || '-', ...args],
      memoryLimitMb,
      timeoutMs: 120000,
    });
    const json = (t) =>
      t
        .split('\n')
        .filter((l) => l.startsWith('{"file"'))
        .join('\n');
    if (g.exitCode === 0 && json(g.stdout) === json(node.stdout)) minimal = trial;
  }
  console.log(`\nminimal ponyfill set with text = node: [${minimal.join(', ')}]`);
}
await sandbox.destroy();
if (jsonOut)
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ name, minimal, nodeExit: node.status, nodeStderr: short(node.stderr).slice(0, 30), steps }, null, 2)}\n`,
  );
