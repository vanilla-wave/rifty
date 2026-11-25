import { type Page, expect, test } from '@playwright/test';
import {
  GREEN_BY,
  type OracleStep,
  type Pin,
  STEPS,
  type StepId,
  observed,
  outPath,
  pinOf,
  runOracle,
} from '../../packages/isolate-host/tests/zlib-scenario.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
} from './fixtures.ts';
import {
  BROWSER_ERRORS,
  BROWSER_STDOUT,
  STEP_URL,
  UNPACK,
  serveSteps,
} from './fixtures/zlib-scenario.ts';

// node:zlib goal carrier (backlog runtime-js/zlib-node-acceptance-carrier), COI Workbench host
// (kernel child `node`, Chromium): each step's workspace unpacked by a guest `node` to `/tmp/z<id>`
// (out of the project tree, keeping it small: a guest write's cost grows with the project's file
// count today, backlog perf/workbench-guest-write-cost-grows-with-project), run by a rifty `node` runner that spawns
// `node <step> <out>` with piped stdio (the shell has no `2>`), against live `node <step>` over the
// same files. Today's outcome pinned whole per step; the unit delivering it compares with Node.

const RUNNER = `const { spawn } = require('node:child_process');
const [dir, ...argv] = process.argv.slice(2);
const child = spawn('node', argv, { cwd: require('node:path').resolve(dir), stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
child.on('close', (exitCode) => {
  const out = require('node:path').resolve(dir, argv[1]);
  const file = require('node:fs').existsSync(out) ? require('node:fs').readFileSync(out).toString('base64') : null;
  process.stdout.write('@@ZS' + JSON.stringify({ stdout, stderr, exitCode, file }) + 'ZS@@\\n');
});
`;

/** Today's outcome, measured on main dfad6553e: an uncaught error exits 1 with its stderr line. */
const PINS: Readonly<Record<StepId, Pin>> = Object.fromEntries(
  STEPS.map(({ id }) => {
    const error = BROWSER_ERRORS[id];
    return [
      id,
      {
        exitCode: error === null ? 0 : 1,
        stdout: BROWSER_STDOUT[id] ?? '',
        // An error thrown from an archiver queue task: the Workbench reports it as `Uncaught`.
        error: id === '1' ? `Uncaught ${error} (<source>)` : error,
        output: null,
      },
    ];
  }),
) as Record<StepId, Pin>;

let oracle: ReadonlyMap<StepId, OracleStep> | undefined;
const oracleOf = (): ReadonlyMap<StepId, OracleStep> => {
  oracle ??= runOracle();
  return oracle;
};
let page: Page;

/** The step's run in the Workbench, its output read back by the runner. */
async function inWorkbench(step: OracleStep['step']): Promise<ReturnType<typeof observed>> {
  const dir = `z${step.id}`;
  await page.evaluate(
    async ({ fixtureUrl, url, path }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await fixture.currentProject().files.writeFile(path, body, { expectedVersion: null });
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, url: `${STEP_URL}${step.id}`, path: `/${dir}.bin` },
  );
  const unpack = await execLine(page, `node zunpack.cjs ${dir}.bin /tmp/${dir}`);
  expect(unpack.exit, unpack.out).toBe(0);
  const run = await execLine(page, `node zrun.cjs /tmp/${dir} ${step.program} ${outPath(step)}`);
  const json = /@@ZS(.*)ZS@@/su.exec(run.out)?.[1];
  if (json === undefined) throw new Error(`runner printed no result\n${run.out}`);
  const r = JSON.parse(json) as {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    file: string | null;
  };
  return observed({ ...r, file: r.file === null ? undefined : Buffer.from(r.file, 'base64') });
}

test.describe('node:zlib goal scenario vs Node (COI Workbench)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    page = await browser.newPage();
    await serveSteps(page, oracleOf);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-zlib-scenario',
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await page.evaluate(
      async ({ fixtureUrl, text }) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        await fixture.writeProjectText('/scratch/zrun.cjs', text.runner);
        await fixture.writeProjectText('/scratch/zunpack.cjs', text.unpack);
      },
      { fixtureUrl: sealedWorkbenchFixtureUrl, text: { runner: RUNNER, unpack: UNPACK } },
    );
  });
  test.afterAll(async () => {
    await closeOwner(page);
    await page.close();
  });

  for (const step of STEPS) {
    test(`${step.id} ${step.title} — today pinned; ${GREEN_BY}`, async () => {
      test.setTimeout(300_000);
      const s = oracleOf().get(step.id);
      if (s === undefined) throw new Error(`no oracle for ${step.id}`);
      const rifty = pinOf(await inWorkbench(step));
      expect(rifty).toEqual(PINS[step.id]);
      expect(rifty, 'the pin is a gap against live Node').not.toEqual(pinOf(observed(s.node)));
    });
  }
});
