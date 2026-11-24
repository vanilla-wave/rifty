/**
 * ADR-0574 Acceptance 2–5 in the isolate guest (no `URL` when the runtime loads): Node
 * v24.16.0's own url/querystring test calls and IdnaTestV2 hosts (`runtime-js/tests/fixtures/
 * url-legacy`), each as `node program.cjs <in> <out>` in a sandbox and in live Node over the same
 * files. Equal on every row, except the rows whose hostname reaches Node's `toASCII` with a
 * non-ASCII or `xn--` label (`idnaStep`, recorded from Node's own lib/url.js): there the
 * named gap, until the isolate has a host `URL` (Acceptance 4's default).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUEST_DIRS, MemoryFsSync, snapshotFs } from '../src/codec.ts';
import { createSandbox } from '../src/index.ts';
import {
  closureFiles,
  inNode as closureInNode,
  inSandbox as closureInSandbox,
} from './package-closure.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = fileURLToPath(
  new URL('../../runtime-js/tests/fixtures/url-legacy/', import.meta.url),
);
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const GAP = 'Not implemented: url.toASCII';

interface Outcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly out?: string;
}

function inNode(
  files: Readonly<Record<string, string>>,
  args: readonly string[],
  out?: string,
): Outcome {
  expect(process.version).toBe('v24.16.0');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'isolate-url-legacy-')));
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    const r = spawnSync(process.execPath, args, {
      cwd: dir,
      env: {},
      encoding: 'utf8',
      timeout: 120_000,
    });
    let text: string | undefined;
    try {
      if (out !== undefined) text = readFileSync(join(dir, out), 'utf8');
    } catch {}
    return {
      stdout: r.stdout,
      stderr: r.stderr.split(dir).join('/workspace'),
      exitCode: r.status,
      out: text,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function inSandbox(
  files: Readonly<Record<string, string>>,
  args: readonly string[],
  out?: string,
): Promise<Outcome> {
  const fs = new MemoryFsSync();
  for (const dir of GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const path = `/workspace/${rel}`;
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, new TextEncoder().encode(text));
  }
  const maxFsBytes = 64 * 2 ** 20;
  const sb = await createSandbox({
    snapshot: snapshotFs(fs, { template: null, maxBytes: maxFsBytes }),
    maxFsBytes,
  });
  try {
    const [entry, ...rest] = args;
    const r = await sb.exec(entry ?? '', { args: rest, timeoutMs: 120_000, memoryLimitMb: 512 });
    let text: string | undefined;
    try {
      if (out !== undefined) text = new TextDecoder().decode(await sb.readFile(out));
    } catch {}
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, out: text };
  } finally {
    await sb.destroy();
  }
}

type Rec = { readonly ok?: unknown; readonly throw?: { name?: string; message?: string } };

async function corpus(name: string): Promise<{ node: Rec[]; rifty: Rec[]; step: Set<number> }> {
  const files = {
    'codec.cjs': read('codec.cjs'),
    'replay.cjs': read('replay.cjs'),
    'program.cjs': read('program.cjs'),
    'in.json': read(name),
  };
  const args = ['program.cjs', 'in.json', 'out.json'];
  const node = inNode(files, args, 'out.json');
  const rifty = await inSandbox(files, args, 'out.json');
  expect(node.exitCode, node.stderr).toBe(0);
  expect(rifty.exitCode, rifty.stderr).toBe(0);
  const step = (JSON.parse(read(name)) as { idnaStep?: number[] }).idnaStep ?? [];
  return {
    node: JSON.parse(node.out ?? '[]'),
    rifty: JSON.parse(rifty.out ?? '[]'),
    step: new Set(step),
  };
}

/** Rows that differ from Node, outside the named-gap rows; and gap rows that are not the gap. */
function verdict({ node, rifty, step }: { node: Rec[]; rifty: Rec[]; step: Set<number> }) {
  expect(rifty.length).toBe(node.length);
  const wrong: { i: number; node: Rec; rifty: Rec | undefined }[] = [];
  node.forEach((expected, i) => {
    const actual = rifty[i];
    const gap =
      actual?.throw?.name === 'NotImplementedError' && actual.throw.message?.startsWith(GAP);
    if (step.has(i) ? !gap : JSON.stringify(expected) !== JSON.stringify(actual))
      wrong.push({ i, node: expected, rifty: actual });
  });
  return { count: wrong.length, first: wrong.slice(0, 5) };
}

describe('isolate guest: legacy node:url and node:querystring are Node v24.16.0s', () => {
  it('url: 1 314 calls; the 44 non-ASCII-hostname parses are the named gap', async () => {
    const result = await corpus('url-calls.json');
    expect(result.step.size).toBe(44);
    expect(verdict(result)).toEqual({ count: 0, first: [] });
  }, 240_000);

  it('querystring: every call of test-querystring*.js', async () => {
    expect(verdict(await corpus('querystring-calls.json'))).toEqual({ count: 0, first: [] });
  }, 240_000);

  it('IdnaTestV2 + probe hosts: ASCII rows equal, non-ASCII/xn-- rows the named gap', async () => {
    expect(verdict(await corpus('hosts.json'))).toEqual({ count: 0, first: [] });
  }, 240_000);

  it('a URL the guest assigns later is never called', async () => {
    const files = {
      'main.js': `globalThis.URL = function URL() { throw new Error('guest URL called'); };
const url = require('url');
console.log(url.parse('http://a.com/').hostname);
try { url.parse('http://ñ.com/'); } catch (e) { console.log(e.name, e.message); }`,
    };
    const r = await inSandbox(files, ['main.js']);
    expect(r.stdout.split('\n').slice(0, 2)).toEqual([
      'a.com',
      expect.stringMatching(/^NotImplementedError Not implemented: url\.toASCII/),
    ]);
  }, 120_000);
});

const requireFixture = createRequire(join(FIXTURES, 'codec.cjs'));
const DEP_ROWS = requireFixture('./dep0169-rows.cjs') as Record<string, Record<string, string>>;

const GUEST_ROWS = requireFixture('./guest-rows.cjs') as Record<
  string,
  { hosts: string[]; files: Record<string, string> }
>;

describe('isolate guest: patched intrinsics do not reach the port where Node does not use them', () => {
  for (const [name, row] of Object.entries(GUEST_ROWS)) {
    if (!row.hosts.includes('isolate')) continue;
    it(name, async () => {
      const node = inNode(row.files, ['main.js']);
      const rifty = await inSandbox(row.files, ['main.js']);
      expect({ stdout: rifty.stdout, exitCode: rifty.exitCode }).toEqual({
        stdout: node.stdout,
        exitCode: node.exitCode,
      });
    }, 60_000);
  }
});

describe('isolate guest: DEP0169/DEP0170 by Node v24.16.0s 4-frame window', () => {
  for (const [name, files] of Object.entries(DEP_ROWS)) {
    it(name, async () => {
      const node = inNode(files, ['main.js']);
      const rifty = await inSandbox(files, ['main.js']);
      expect({ stdout: rifty.stdout, exitCode: rifty.exitCode }).toEqual({
        stdout: node.stdout,
        exitCode: node.exitCode,
      });
    }, 60_000);
  }
});

/** The pid in `(node:<pid>)` and the program name in Node's `--trace-*` hint. */
const mask = (stderr: string): string =>
  stderr
    .replace(/^\((?:node|rifty):\d+\)/gm, '(node:<pid>)')
    .replace(/\(Use `\w+ --trace/g, '(Use `<argv0> --trace');

describe('user scenario: parseurl 1.3.3 + legacy url in a sandbox (Acceptance 1)', () => {
  const closure = closureFiles('parseurl', realpathSync(join(here, '../node_modules/parseurl')));
  const files = new Map(closure).set('main.js', readFileSync(join(FIXTURES, 'scenario-main.js')));
  it('Node prints five lines and DEP0169; the isolate stops at the non-ASCII host (declared, Acceptance 4)', async () => {
    const node = closureInNode(files, 'main.js', 'unused');
    const rifty = await closureInSandbox(files, 'main.js', 'unused');
    expect(node.exitCode, node.stderr).toBe(0);
    const lines = node.stdout.split('\n');
    expect(lines[3]).toBe('xn--ida.com');
    // Declared isolate outcome: Node's first three lines, then the named gap, exit 1. Flips
    // to Node's full output once the isolate translates hostnames (option (d) or a guest URL).
    expect(rifty.stdout).toBe(`${lines.slice(0, 3).join('\n')}\n`);
    expect(rifty.exitCode).toBe(1);
    const warning = mask(node.stderr);
    expect(mask(rifty.stderr).startsWith(warning), rifty.stderr).toBe(true);
    expect(mask(rifty.stderr).slice(warning.length)).toContain(
      'NotImplementedError: Not implemented: url.toASCII',
    );
  }, 120_000);
});
