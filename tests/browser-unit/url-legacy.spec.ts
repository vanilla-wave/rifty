import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  readOwnerFile,
  writeOwnerFile,
} from './fixtures.ts';

// ADR-0574, COI Workbench host (Chromium, kernel child `node`): legacy node:url / querystring
// against live Node v24.16.0 over the same files. Corpora: runtime-js/tests/fixtures/url-legacy.
// `toASCII` takes Chromium's `URL` (contract Acceptance 4, the manager's default): the residual
// rows are pinned exactly (`chromium-residual.json`; each must still differ).

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '../../packages/runtime-js/tests/fixtures/url-legacy');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const requireFixture = createRequire(join(FIXTURES, 'codec.cjs'));
const DEP_ROWS = requireFixture('./dep0169-rows.cjs') as Record<string, Record<string, string>>;
const GUEST_ROWS = requireFixture('./guest-rows.cjs') as Record<
  string,
  { hosts: string[]; files: Record<string, string> }
>;
const PARSEURL = join(here, '../../packages/isolate-host/node_modules/parseurl');

// The shell has no `2>`: a runner spawns `node <argv>` with piped stdio and prints both streams.
const RUNNER = `const { spawn } = require('node:child_process');
const [dir, ...argv] = process.argv.slice(2);
const child = spawn('node', argv, { cwd: require('node:path').resolve(dir), stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
child.on('close', (exitCode) => process.stdout.write('@@UL' + JSON.stringify({ stdout, stderr, exitCode }) + 'UL@@\\n'));
`;

interface Outcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

function inNode(
  files: Readonly<Record<string, string>>,
  argv: readonly string[],
): Outcome & { dir: string } {
  expect(process.version).toBe('v24.16.0');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bu-url-legacy-')));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  const r = spawnSync(process.execPath, argv, {
    cwd: dir,
    env: {},
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { dir, stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
}

function packageFiles(root: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string): void => {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[`${prefix}/${relative(root, path)}`] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}

const mask = (stderr: string): string =>
  stderr
    .replace(/^\((?:node|rifty):\d+\)/gm, '(node:<pid>)')
    .replace(/\(Use `\w+ --trace/g, '(Use `<argv0> --trace');

type Rec = unknown;
const same = (a: Rec, b: Rec): boolean => JSON.stringify(a) === JSON.stringify(b);

test('legacy node:url / querystring equal Node (COI Workbench)', async ({ page, browser }) => {
  test.setTimeout(900_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-url-legacy',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  let n = 0;
  async function inRifty(
    files: Readonly<Record<string, string>>,
    argv: readonly string[],
  ): Promise<Outcome> {
    const dir = `ul/r${n++}`;
    await writeOwnerFile(page, `/scratch/${dir}/.keep`, '');
    for (const [rel, text] of Object.entries(files))
      await writeOwnerFile(page, `/scratch/${dir}/${rel}`, text);
    const run = await execLine(page, `node ul/runner.cjs ${dir} ${argv.join(' ')}`);
    const json = /@@UL(.*)UL@@/su.exec(run.out)?.[1];
    if (json === undefined) throw new Error(`runner printed no result\n${run.out}`);
    return JSON.parse(json) as Outcome;
  }
  async function corpus(name: string): Promise<{ node: Rec[]; rifty: Rec[] }> {
    const files = {
      'codec.cjs': read('codec.cjs'),
      'replay.cjs': read('replay.cjs'),
      'program.cjs': read('program.cjs'),
      'in.json': read(name),
    };
    const oracle = inNode(files, ['program.cjs', 'in.json', 'out.json']);
    const node = JSON.parse(readFileSync(join(oracle.dir, 'out.json'), 'utf8')) as Rec[];
    rmSync(oracle.dir, { recursive: true, force: true });
    const dir = `ul/c-${name.replace('.json', '')}`;
    for (const [rel, text] of Object.entries(files))
      await writeOwnerFile(page, `/scratch/${dir}/${rel}`, text);
    const run = await execLine(
      page,
      `cd /home/project/${dir} && node program.cjs in.json out.json`,
    );
    await execLine(page, 'cd /home/project');
    expect(run.exit, run.out).toBe(0);
    const out = await readOwnerFile(page, `/scratch/${dir}/out.json`);
    expect(out.ok, out.error).toBe(true);
    return { node, rifty: JSON.parse(out.text) as Rec[] };
  }
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await writeOwnerFile(page, '/scratch/ul/package.json', '{}\n');
    await writeOwnerFile(page, '/scratch/ul/runner.cjs', RUNNER);

    // Acceptance 2, 5: 0 differ.
    for (const name of ['url-calls.json', 'querystring-calls.json']) {
      const { node, rifty } = await corpus(name);
      expect(rifty.length).toBe(node.length);
      const diff = node.flatMap((r, i) =>
        same(r, rifty[i]) ? [] : [{ i, node: r, rifty: rifty[i] }],
      );
      expect.soft(diff.slice(0, 5), `${name}: ${diff.length} differ`).toEqual([]);
    }

    // Acceptance 4: IdnaTestV2 + probe hosts equal Node except the pinned residual, exactly.
    {
      const { node, rifty } = await corpus('hosts.json');
      const pinned = JSON.parse(read('chromium-residual.json')) as {
        rows: { i: number; node: Rec; rifty: Rec }[];
      };
      const pins = new Map(pinned.rows.map((row) => [row.i, row]));
      const wrong = node.flatMap((r, i) => {
        const pin = pins.get(i);
        const ok =
          pin === undefined
            ? same(r, rifty[i])
            : same(pin.node, r) && same(pin.rifty, rifty[i]) && !same(r, rifty[i]);
        return ok ? [] : [{ i, node: r, rifty: rifty[i], pin: pin?.rifty ?? null }];
      });
      expect
        .soft(
          wrong.slice(0, 5),
          `hosts: ${wrong.length} rows off (${pins.size} pinned on Chromium ${pinned.chromium}; this run ${browser.browserType().name()} ${browser.version()})`,
        )
        .toEqual([]);
    }

    // Acceptance 1: the user scenario, all five lines and DEP0169 as Node.
    {
      const files = {
        ...packageFiles(PARSEURL, 'node_modules/parseurl'),
        'main.js': read('scenario-main.js'),
      };
      const node = inNode(files, ['main.js']);
      rmSync(node.dir, { recursive: true, force: true });
      const rifty = await inRifty(files, ['main.js']);
      expect.soft({ ...rifty, stderr: mask(rifty.stderr) }, 'scenario').toEqual({
        stdout: node.stdout,
        stderr: mask(node.stderr),
        exitCode: node.exitCode,
      });
    }

    // ADR-0574 §2: a guest's patched intrinsics do not reach the port where Node's do not.
    for (const [name, row] of Object.entries(GUEST_ROWS)) {
      if (!row.hosts.includes('browser')) continue;
      const node = inNode(row.files, ['main.js']);
      rmSync(node.dir, { recursive: true, force: true });
      const rifty = await inRifty(row.files, ['main.js']);
      expect.soft({ stdout: rifty.stdout, exitCode: rifty.exitCode }, name).toEqual({
        stdout: node.stdout,
        exitCode: node.exitCode,
      });
    }

    // ADR-0574 §4: DEP0169/DEP0170 window rows.
    for (const [name, files] of Object.entries(DEP_ROWS)) {
      const node = inNode(files, ['main.js']);
      rmSync(node.dir, { recursive: true, force: true });
      const rifty = await inRifty(files, ['main.js']);
      expect.soft({ stdout: rifty.stdout, exitCode: rifty.exitCode }, name).toEqual({
        stdout: node.stdout,
        exitCode: node.exitCode,
      });
    }

    // Acceptance 3: a URL the guest assigns later is never called; the load-time one is.
    {
      const files = {
        'main.js': `globalThis.URL = function URL() { throw new Error('guest URL called'); };
const url = require('url');
console.log(url.parse('http://a.com/').hostname, url.parse('http://ñ.com/').hostname);`,
      };
      const rifty = await inRifty(files, ['main.js']);
      expect.soft(rifty.stdout, rifty.stderr).toBe('a.com xn--ida.com\n');
    }
  } finally {
    await closeOwner(page);
  }
});
