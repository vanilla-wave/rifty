/**
 * Acceptance carrier of goal `isolate-host-live-sandbox` (its `## User
 * scenario` as tests). The oracle is real `node <path> [args]`, run in sequence
 * over the same files in a fresh temporary directory read as `/workspace`
 * (`support.ts` nodeSequence). RED: every case is `it.fails` until the sandbox
 * lands; the API is typed here from the goal's contract, not imported.
 */
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';
import {
  type FileTree,
  type NodeStep,
  childPids,
  nodeSequence,
  rssKb,
  waitFor,
} from './support.ts';

/** RED until the sandbox lands; flips to `it` with the implementation. */
const carrier = it.fails;

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly termination?: 'timeout' | 'memory';
  readonly truncated?: true;
  /** The run ended on its own but its end state was not kept (the reason's code); the state is as before it. */
  readonly stateRefused?: string;
}
interface Entry {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly size: number;
}
interface Sandbox {
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  list(path?: string): Promise<readonly Entry[]>;
  remove(path: string): Promise<void>;
  exec(
    path: string,
    options?: { args?: readonly string[]; timeoutMs?: number; memoryLimitMb?: number },
  ): Promise<ExecResult>;
  snapshot(): Promise<Uint8Array>;
  destroy(): Promise<void>;
}
interface SandboxOptions {
  readonly snapshot?: Uint8Array;
  /** Per host file op. */
  readonly maxFileBytes?: number;
  /** The sandbox's whole state (the snapshot codec's count). */
  readonly maxFsBytes?: number;
}
const createSandbox = (options?: SandboxOptions): Promise<Sandbox> =>
  (pkg as unknown as { createSandbox: (o?: unknown) => Promise<Sandbox> }).createSandbox(options);

const W = '/workspace';
const bytes = (...b: number[]) => new Uint8Array(b);

/** Every file under `dir`, recursively, as the host API sees it. */
async function tree(sb: Sandbox, dir = W): Promise<FileTree> {
  const out: Record<string, string> = {};
  for (const e of await sb.list(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.type === 'directory') {
      out[`${path}/`] = 'dir';
      Object.assign(out, await tree(sb, path));
    } else out[path] = Buffer.from(await sb.readFile(path)).toString('base64');
  }
  return out;
}

/**
 * The part of an uncaught-error report this goal owns: the error line and the
 * user files its frames name, in order. Positions, the `file:line` header and
 * the footer belong to the runtime-js diagnostics goal (pinned ⚠️ there).
 */
function errorView(stderr: string): { error: string | undefined; files: string[] } {
  const lines = stderr.split('\n');
  const error = lines.find((l) => /^[A-Za-z]*Error\b/.test(l));
  const files = lines.flatMap((l) => /\((\/workspace\/[^:)]+):\d+:\d+\)$/.exec(l)?.[1] ?? []);
  return { error, files };
}

const BUGGY = `const fs = require('fs');
const input = fs.readFileSync(__dirname + '/input.bin');
const pdf = makePdf(input);
fs.writeFileSync(process.argv[2], pdf);
`;
const FIXED = `const fs = require('fs');
const { makePdf } = require('./lib/pdf');
const input = fs.readFileSync(__dirname + '/input.bin');
fs.mkdirSync(require('path').dirname(process.argv[2]), { recursive: true });
fs.writeFileSync(process.argv[2], makePdf(input));
console.log('wrote', process.argv[2], require.main === module);
`;
const PDF_LIB = `exports.makePdf = (input) => Buffer.concat([
  Buffer.from('%PDF-1.4\\n'), input, Buffer.from([0, 0xff, 0x80]), Buffer.from('\\n%%EOF\\n'),
]);
`;
const INPUT = bytes(0, 1, 2, 0xfe, 0xff, 0x0a, 0x0d, 0x80);

describe('write → run → error → fix → run (scenario 1–3)', () => {
  carrier('the model fixes its error and the host reads the binary result', async () => {
    const steps: NodeStep[] = [
      { files: { 'main.js': BUGGY, 'input.bin': INPUT }, run: ['main.js', 'out/report.pdf'] },
      { files: { 'main.js': FIXED, 'lib/pdf.js': PDF_LIB }, run: ['main.js', 'out/report.pdf'] },
    ];
    const oracle = nodeSequence(steps);
    const sb = await createSandbox();
    try {
      await sb.writeFile('main.js', BUGGY);
      await sb.writeFile(`${W}/input.bin`, INPUT);
      const failed = await sb.exec('main.js', { args: ['out/report.pdf'] });
      expect(failed.exitCode).toBe(1);
      expect(failed.stdout).toBe(oracle[0]?.stdout);
      expect(errorView(failed.stderr)).toEqual(errorView(oracle[0]?.stderr ?? ''));
      expect(errorView(failed.stderr).error).toBe('ReferenceError: makePdf is not defined');

      await sb.writeFile('main.js', FIXED);
      await sb.writeFile('lib/pdf.js', PDF_LIB);
      const ok = await sb.exec('main.js', { args: ['out/report.pdf'] });
      expect(ok).toEqual({ stdout: oracle[1]?.stdout, stderr: oracle[1]?.stderr, exitCode: 0 });
      expect(ok.stdout).toBe('wrote out/report.pdf true\n');
      expect(await tree(sb)).toEqual(oracle[1]?.files);
      const pdf = await sb.readFile('out/report.pdf');
      expect(Buffer.from(pdf).toString('base64')).toBe(oracle[1]?.files[`${W}/out/report.pdf`]);
    } finally {
      await sb.destroy();
    }
  });
});

describe('an endless loop and eaten memory are ordinary errors (scenario 4, I1)', () => {
  carrier(
    'timeout and memory leave the files of before the run; the next fix runs',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('keep.txt', 'kept');
        await sb.writeFile('loop.js', "require('fs').writeFileSync('partial', 'x'); for (;;) {}");
        const before = await tree(sb);
        const loop = await sb.exec('loop.js', { timeoutMs: 1500 });
        expect(loop).toMatchObject({ exitCode: null, termination: 'timeout' });
        expect(await tree(sb)).toEqual(before);
        for (const code of [
          "const a = []; for (;;) a.push({ x: Math.random(), s: 'y'.repeat(100) })",
          'new Array(2 ** 28).fill(0)',
        ]) {
          await sb.writeFile('mem.js', `require('fs').writeFileSync('partial', 'x'); ${code}`);
          const mem = await sb.exec('mem.js', { memoryLimitMb: 64, timeoutMs: 60_000 });
          expect(mem).toMatchObject({ exitCode: null, termination: 'memory' });
          expect(Object.keys(await tree(sb))).not.toContain(`${W}/partial`);
        }
        await sb.writeFile(
          'fixed.js',
          "console.log(require('fs').readFileSync('keep.txt', 'utf8'))",
        );
        expect(await sb.exec('fixed.js')).toEqual({ stdout: 'kept\n', stderr: '', exitCode: 0 });
      } finally {
        await sb.destroy();
      }
    },
    120_000,
  );
});

describe('only files carry between runs (scenario 5, I2)', () => {
  carrier('a sequence of runs equals the same sequence of node processes', async () => {
    const steps: NodeStep[] = [
      {
        files: {
          'm.js': 'module.exports = { count: 0 };',
          'a.js': `globalThis.leak = 1; process.exitCode = 3; process.chdir('/');
process.on('exit', () => console.log('bye'));
require('./m').count++; setTimeout(() => {}, 10);
require('fs').writeFileSync(__dirname + '/n.txt', String(require('./m').count));`,
          'b.js': `console.log(typeof leak, process.exitCode, require('./m').count,
  require('fs').readFileSync('n.txt', 'utf8'), process.listenerCount('exit'), process.cwd());`,
        },
        run: ['a.js'],
      },
      { files: {}, run: ['b.js'] },
    ];
    const oracle = nodeSequence(steps);
    const sb = await createSandbox();
    try {
      for (const [name, data] of Object.entries(steps[0]?.files ?? {}))
        await sb.writeFile(name, data);
      for (const [i, step] of steps.entries()) {
        const [path, ...args] = step.run;
        const r = await sb.exec(path as string, { args });
        expect(r).toEqual({
          stdout: oracle[i]?.stdout,
          stderr: oracle[i]?.stderr,
          exitCode: oracle[i]?.exitCode,
        });
        expect(await tree(sb)).toEqual(oracle[i]?.files);
      }
    } finally {
      await sb.destroy();
    }
  });
});

describe('operations take effect one at a time in call order (scenario 6, I4)', () => {
  carrier('writes and runs issued without awaiting apply in order', async () => {
    const sb = await createSandbox();
    try {
      const [, first, , second, last] = await Promise.all([
        sb.writeFile('v.js', "console.log('v1')"),
        sb.exec('v.js'),
        sb.writeFile('v.js', "console.log('v2'); require('fs').writeFileSync('w', 'run2')"),
        sb.exec('v.js'),
        sb.readFile('w'),
      ]);
      expect(first).toEqual({ stdout: 'v1\n', stderr: '', exitCode: 0 });
      expect(second).toEqual({ stdout: 'v2\n', stderr: '', exitCode: 0 });
      expect(Buffer.from(last).toString()).toBe('run2');
    } finally {
      await sb.destroy();
    }
  });
});

describe('destroy is loud and total (scenario 7, I5)', () => {
  carrier('a run and queued operations in flight reject DESTROYED, later ones too', async () => {
    const sb = await createSandbox();
    await sb.writeFile('spin.js', 'for (;;) {}');
    const running = sb.exec('spin.js', { timeoutMs: 30_000 });
    const queued = sb.writeFile('after.txt', 'x');
    const destroyed = sb.destroy();
    const code = { code: 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED' };
    const [run, write] = await Promise.allSettled([running, queued]);
    expect(run).toMatchObject({ status: 'rejected', reason: code });
    expect(write).toMatchObject({ status: 'rejected', reason: code });
    await destroyed;
    await expect(sb.readFile('spin.js')).rejects.toMatchObject(code);
    await expect(sb.exec('spin.js')).rejects.toMatchObject(code);
  });
});

describe('host refusals are loud and name only sandbox paths (scenario 8, I6, I7)', () => {
  carrier('missing file, invalid path; another sandbox is invisible', async () => {
    const a = await createSandbox();
    const b = await createSandbox();
    try {
      const missing = await a.readFile('nope/out.pdf').catch((e: unknown) => e);
      expect(missing).toMatchObject({ code: 'ENOENT', path: `${W}/nope/out.pdf` });
      for (const host of [process.cwd(), tmpdir(), fileURLToPath(new URL('..', import.meta.url))])
        expect(String((missing as Error).message)).not.toContain(host);
      await expect(a.writeFile('bad\0name', 'x')).rejects.toMatchObject({
        code: 'ERR_INVALID_ARG_VALUE',
      });
      await a.writeFile('secret.txt', 'canary-a');
      await b.writeFile(
        'peek.js',
        "const fs = require('fs'); console.log(fs.existsSync('/workspace/secret.txt'), JSON.stringify(fs.readdirSync('/workspace')))",
      );
      expect(await b.exec('peek.js')).toEqual({
        stdout: 'false ["peek.js"]\n',
        stderr: '',
        exitCode: 0,
      });
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});

describe('snapshot round trip (scenario 9, I9)', () => {
  carrier('a sandbox created from a snapshot runs over the same files', async () => {
    const sb = await createSandbox();
    await sb.writeFile(
      'main.js',
      "require('fs').writeFileSync('made.bin', Buffer.from([7, 0, 255]))",
    );
    expect((await sb.exec('main.js')).exitCode).toBe(0);
    const files = await tree(sb);
    const snapshot = await sb.snapshot();
    await sb.destroy();
    const again = await createSandbox({ snapshot });
    try {
      expect(await tree(again)).toEqual(files);
      await again.writeFile('read.js', "console.log([...require('fs').readFileSync('made.bin')])");
      expect(await again.exec('read.js')).toEqual({
        stdout: '[ 7, 0, 255 ]\n',
        stderr: '',
        exitCode: 0,
      });
    } finally {
      await again.destroy();
    }
  });
});

describe('ESM entries are a loud gap (I2)', () => {
  const FORMS: Record<string, Record<string, string>> = {
    '.mjs': { 'main.mjs': 'console.log(1)' },
    '"type": "module"': { 'main.js': 'console.log(1)', 'package.json': '{"type":"module"}' },
    'ESM syntax in a typeless .js': { 'main.js': "import fs from 'fs'; console.log(typeof fs)" },
  };
  for (const [form, files] of Object.entries(FORMS)) {
    carrier(`${form}: the named gap; real node runs it`, async () => {
      const entry = Object.keys(files)[0] as string;
      expect(nodeSequence([{ files, run: [entry] }])[0]?.exitCode).toBe(0);
      const sb = await createSandbox();
      try {
        for (const [name, data] of Object.entries(files)) await sb.writeFile(name, data);
        const r = await sb.exec(entry);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('Not implemented: isolate-host.esm');
      } finally {
        await sb.destroy();
      }
    });
  }
});

/** Scenario 1–2 corpus: each row is a two-run sequence over the same files, compared with node's. */
interface CorpusRow {
  readonly label: string;
  readonly files: Readonly<Record<string, string>>;
  readonly runs: readonly (readonly string[])[];
  /** Only the diagnostic text differs from node's: the runtime-js diagnostics goal's (⚠️). */
  readonly diagnosticText?: true;
}
const CORPUS: readonly CorpusRow[] = [
  {
    label:
      'no node -e builtin-module globals in a file; stdout.write without a newline; an empty directory',
    files: {
      'main.js': `process.stdout.write(typeof fs + ' ' + typeof path + ' ' + typeof crypto.randomUUID);
require('fs').mkdirSync('empty/inner', { recursive: true });`,
      'next.js': "console.log(require('fs').readdirSync('empty'))",
    },
    runs: [['main.js'], ['next.js']],
  },
  {
    label: 'process.exit(N) after a write: synchronous, then from a timer',
    files: {
      'sync.js': "require('fs').writeFileSync('s', '1'); process.exit(3)",
      'timer.js': "require('fs').writeFileSync('t', '1'); setTimeout(() => process.exit(4), 10)",
      'listener.js': "process.on('exit', () => require('fs').writeFileSync('l', '1'))",
    },
    runs: [['sync.js'], ['timer.js'], ['listener.js']],
  },
  {
    // Manager gate (2026-11-22): `process.exit` from a microtask ends as `timeout` in `-e`
    // (compat ⚠️, thread #416), which here would roll the run's files back.
    label: 'process.exit(N) after a write: from a promise callback, then from queueMicrotask',
    files: {
      'p.js':
        "require('fs').writeFileSync('p', '1'); Promise.resolve().then(() => process.exit(5))",
      'q.js': "require('fs').writeFileSync('q', '1'); queueMicrotask(() => process.exit(6))",
    },
    runs: [['p.js'], ['q.js']],
  },
  {
    label: 'relative require, JSON, __filename, __dirname, argv, require.main, relative paths',
    files: {
      'main.js': `const conf = require('./conf.json'); const lib = require('./lib/x');
console.log(conf.name, lib.v, __filename, __dirname, JSON.stringify(process.argv.slice(1)), require.main === module, module.id);
require('fs').writeFileSync('rel/out.txt', require('path').relative(__dirname, __filename));`,
      'conf.json': '{"name":"c"}',
      'lib/x.js': 'exports.v = require.main === module ? "main" : "dep";',
      'rel/.keep': '',
      'second.js': "console.log(require('fs').readFileSync('rel/out.txt', 'utf8'))",
    },
    runs: [['main.js', 'a b', '--flag'], ['second.js']],
  },
  {
    label: 'if (require.main === module) main()',
    files: {
      'cli.js': "function main() { console.log('ran') }\nif (require.main === module) main();\n",
    },
    runs: [['cli.js'], ['./cli.js']],
  },
  {
    label: 'uncaught throw in a dependency names both files',
    files: {
      'main.js': "require('./dep');\n",
      'dep.js': "function f() { throw new TypeError('bad thing') }\nf();\n",
    },
    runs: [['main.js'], ['main.js']],
  },
  {
    label: 'unhandled rejection of an async main',
    files: { 'main.js': "async function main() { throw new Error('boom') }\nmain();\n" },
    runs: [['main.js']],
  },
  {
    label: 'syntax error in the entry, then in a dependency',
    files: { 'a.js': 'const a = ;\n', 'b.js': "require('./dep')\n", 'dep.js': 'let x = {\n' },
    runs: [['a.js'], ['b.js']],
    diagnosticText: true,
  },
  {
    label: 'missing module',
    files: { 'main.js': "require('./nope')\n" },
    runs: [['main.js'], ['missing.js']],
    diagnosticText: true,
  },
];

describe('node <path> corpus in sequences (scenario 2, 5, I2)', () => {
  for (const row of CORPUS) {
    carrier(row.label, async () => {
      const oracle = nodeSequence(
        row.runs.map((run, i) => ({ files: i === 0 ? row.files : {}, run })),
      );
      const sb = await createSandbox();
      try {
        for (const [name, data] of Object.entries(row.files)) await sb.writeFile(name, data);
        for (const [i, [path, ...args]] of row.runs.entries()) {
          const r = await sb.exec(path as string, { args });
          const o = oracle[i] as (typeof oracle)[number];
          expect(r.stdout).toBe(o.stdout);
          expect(r.exitCode).toBe(o.exitCode);
          if (o.exitCode === 0) expect(r.stderr).toBe(o.stderr);
          else if (row.diagnosticText) {
            // The run fails as node's does and names the file; the text is the diagnostics goal's.
            const named = /\/workspace\/[\w.]+/.exec(o.stderr)?.[0] ?? `${W}/${path}`;
            expect(r.stderr).toContain(named);
          } else expect(errorView(r.stderr)).toEqual(errorView(o.stderr));
          expect(await tree(sb)).toEqual(o.files);
        }
      } finally {
        await sb.destroy();
      }
    });
  }
});

describe('limits are loud (scenario 8, I6)', () => {
  carrier('per-file limit on host ops, one state cap for host writes and run results', async () => {
    const sb = await createSandbox({ maxFileBytes: 1024, maxFsBytes: 64 * 1024 });
    try {
      await expect(sb.writeFile('big.bin', new Uint8Array(1025))).rejects.toMatchObject({
        code: 'ERR_FS_FILE_TOO_LARGE',
      });
      await sb.writeFile('make.js', "require('fs').writeFileSync('g.bin', Buffer.alloc(2000, 1))");
      expect(await sb.exec('make.js')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      expect((await sb.list()).find((e) => e.name === 'g.bin')?.size).toBe(2000);
      await expect(sb.readFile('g.bin')).rejects.toMatchObject({ code: 'ERR_FS_FILE_TOO_LARGE' });
      const before = (await sb.list()).map((e) => e.name);
      await sb.writeFile(
        'fill.js',
        "console.log('done'); require('fs').writeFileSync('huge', Buffer.alloc(100 * 1024))",
      );
      const filled = await sb.exec('fill.js');
      expect(filled).toMatchObject({
        stdout: 'done\n',
        exitCode: 0,
        stateRefused: 'ERR_FS_SNAPSHOT_TOO_LARGE',
      });
      expect((await sb.list()).map((e) => e.name)).toEqual([...before, 'fill.js'].sort());
      // Both views agree after the refusal: the next run does not see `huge` either.
      await sb.writeFile('see.js', "console.log(require('fs').existsSync('huge'))");
      expect((await sb.exec('see.js')).stdout).toBe('false\n');
      for (let i = 0; i < 64; i++) {
        const r = await sb.writeFile(`part${i}.bin`, new Uint8Array(1024)).catch((e: unknown) => e);
        if (r !== undefined) {
          // Some writes fit (the cap is not maxFileBytes), the refused one left nothing.
          expect(i).toBeGreaterThan(8);
          expect(r).toMatchObject({ code: 'ERR_ISOLATE_HOST_SANDBOX_FULL' });
          const names = (await sb.list()).map((e) => e.name);
          expect(names).not.toContain(`part${i}.bin`);
          await sb.remove('part0.bin');
          await sb.writeFile(`part${i}.bin`, new Uint8Array(1024));
          return;
        }
      }
      throw new Error('64 × 1 KiB host writes never met the 64 KiB cap');
    } finally {
      await sb.destroy();
    }
  });
});

describe('host file ops: names, paths, remove (scenario 8, I3, I7)', () => {
  carrier('special names round-trip; paths never leave the sandbox; remove and sizes', async () => {
    const sb = await createSandbox();
    try {
      const names = ['a b.txt', 'ü-é.txt', 'line\nbreak', 'deep/x/y/z/w/v/u/t/s/r/q.txt'];
      for (const n of names) await sb.writeFile(n, n);
      await sb.writeFile('empty', new Uint8Array(0));
      await sb.writeFile(
        'ls.js',
        `const fs = require('fs');
console.log(JSON.stringify(${JSON.stringify(names)}.map((n) => fs.readFileSync(n, 'utf8') === n)), fs.statSync('empty').size);
fs.writeFileSync('/tmp/t.txt', 'tmp');`,
      );
      expect(await sb.exec('ls.js')).toEqual({
        stdout: '[true,true,true,true] 0\n',
        stderr: '',
        exitCode: 0,
      });
      expect(Buffer.from(await sb.readFile('../../tmp/t.txt')).toString()).toBe('tmp');
      expect(await sb.readFile('empty')).toEqual(new Uint8Array(0));
      const escape = await sb.readFile('../../../etc/passwd').catch((e: unknown) => e);
      expect(escape).toMatchObject({ code: 'ENOENT', path: '/etc/passwd' });
      expect((await sb.list()).find((e) => e.name === 'a b.txt')).toEqual({
        name: 'a b.txt',
        type: 'file',
        size: 7,
      });
      await sb.remove('deep');
      await sb.remove('empty');
      const left = (await sb.list()).map((e) => e.name);
      expect(left).not.toContain('deep');
      expect(left).not.toContain('empty');
      await expect(sb.remove('deep')).rejects.toMatchObject({ code: 'ENOENT', path: `${W}/deep` });
    } finally {
      await sb.destroy();
    }
  });

  carrier('no links exist in a sandbox: symlink and link are a loud gap (ADR-0050)', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile(
        'ln.js',
        "require('fs').writeFileSync('a', 'x'); require('fs').symlinkSync('a', 'b')",
      );
      const r = await sb.exec('ln.js');
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('Not implemented: fs.symlinkSync');
      expect((await sb.list()).map((e) => e.type)).toEqual(['file', 'file']);
    } finally {
      await sb.destroy();
    }
  });
});

describe('a lost worker does not repeat a run (I1)', () => {
  carrier(
    'a run whose worker is killed reruns from the same state: its append lands once',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('log.txt', 'start\n');
        // After its append the guest holds 300 MiB: a worker past 400 MiB RSS is one that ran
        // the append (the event the kill waits for); then it waits for its timer.
        await sb.writeFile(
          'slow.js',
          "require('fs').appendFileSync('log.txt', 'run\\n'); globalThis.hold = new Uint8Array(300 << 20).fill(1); setTimeout(() => console.log('done'), 3000)",
        );
        const running = sb.exec('slow.js', { timeoutMs: 30_000, memoryLimitMb: 512 });
        const culprit = await waitFor(
          () => childPids().find((pid) => (rssKb(pid) ?? 0) > 400 * 1024),
          10_000,
        );
        process.kill(culprit, 'SIGKILL');
        expect(await running).toEqual({ stdout: 'done\n', stderr: '', exitCode: 0 });
        expect(Buffer.from(await sb.readFile('log.txt')).toString()).toBe('start\nrun\n');
        // The rerun happened: the killed worker is gone and the run resolved anyway.
        expect(childPids()).not.toContain(culprit);
      } finally {
        await sb.destroy();
      }
    },
  );
});
