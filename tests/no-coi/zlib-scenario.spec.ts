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
  BROWSER_ERRORS,
  BROWSER_STDOUT,
  STEP_URL,
  UNPACK,
  serveSteps,
} from '../browser-unit/fixtures/zlib-scenario.ts';
import { type Page, expect, test } from './fixtures/test.ts';

// node:zlib goal carrier (backlog runtime-js/zlib-node-acceptance-carrier), no-COI SDK host
// (Chromium): one sandbox, each step's workspace unpacked by a guest `node` to `/zs/z<id>`, run as
// `project({ root }).run('node <step> <out>')` against live `node <step>` over the same files.
// Today's outcome pinned whole per step (with the run's `status` and failure); the unit
// delivering it compares with Node instead. COI Workbench twin: tests/browser-unit.

interface SdkPin extends Pin {
  readonly status: string;
  /** The completion's `error`: `name: message [code]`. */
  readonly failure: string | null;
}
/**
 * Today's outcome, measured on main dfad6553e. An uncaught error from an async task fails the run
 * (exit code null, Worker replaced: backlog distribution/no-coi-command-unhandled-rejection-exit); step 1's
 * reaches no stderr, only the Worker-crash failure.
 */
const PINS: Readonly<Record<StepId, SdkPin>> = Object.fromEntries(
  STEPS.map(({ id }) => {
    const error = BROWSER_ERRORS[id];
    const exited = error === null || id === '3r';
    return [
      id,
      {
        exitCode: error === null ? 0 : exited ? 1 : null,
        stdout: BROWSER_STDOUT[id] ?? '',
        error: id === '1' ? null : error,
        output: null,
        status: exited ? 'exited' : 'failed',
        failure: exited
          ? null
          : id === '1'
            ? `Error: Worker crashed: Uncaught ${error} [WORKER_CRASHED]`
            : error,
      },
    ];
  }),
) as Record<StepId, SdkPin>;

const root = process.cwd().replaceAll('\\', '/');
let oracle: ReadonlyMap<StepId, OracleStep> | undefined;
const oracleOf = (): ReadonlyMap<StepId, OracleStep> => {
  oracle ??= runOracle();
  return oracle;
};
let page: Page;

interface SdkRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly status: string;
  readonly failure: string | null;
  readonly file: number[] | null;
}

async function inSdk(step: OracleStep['step']): Promise<SdkPin> {
  const r = await page.evaluate(
    async ({ url, id, program, out, unpack }): Promise<SdkRun> => {
      interface Outcome {
        stdout: string;
        stderr: string;
        exitCode: number | null;
        status: string;
        error?: { name: string; message: string; code?: string };
      }
      const sandbox = (globalThis as Record<string, unknown>).__zlibScenario as {
        fs: {
          writeFile(p: string, d: Uint8Array | string): Promise<void>;
          readFile(p: string): Promise<Uint8Array>;
        };
        project(o: { root: string }): { run(line: string): { completion: Promise<Outcome> } };
      };
      const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await sandbox.fs.writeFile(`/zs/z${id}.bin`, body);
      await sandbox.fs.writeFile('/zs/zunpack.cjs', unpack);
      const unpacked = await sandbox
        .project({ root: '/zs' })
        .run(`node zunpack.cjs z${id}.bin z${id}`).completion;
      if (unpacked.exitCode !== 0) throw new Error(`unpack: ${unpacked.stderr}`);
      const done = await sandbox.project({ root: `/zs/z${id}` }).run(`node ${program} ${out}`)
        .completion;
      let file: number[] | null = null;
      try {
        file = Array.from(await sandbox.fs.readFile(`/zs/z${id}/${out}`));
      } catch {}
      const e = done.error;
      return {
        stdout: done.stdout,
        stderr: done.stderr,
        exitCode: done.exitCode,
        status: done.status,
        failure: e === undefined ? null : `${e.name}: ${e.message}${e.code ? ` [${e.code}]` : ''}`,
        file,
      };
    },
    {
      url: `${STEP_URL}${step.id}`,
      id: step.id,
      program: step.program,
      out: outPath(step),
      unpack: UNPACK,
    },
  );
  const pin = pinOf(
    observed({ ...r, file: r.file === null ? undefined : Uint8Array.from(r.file) }),
  );
  return { ...pin, status: r.status, failure: r.failure };
}

test.describe('node:zlib goal scenario vs Node (no-COI SDK)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    page = await browser.newPage();
    await serveSteps(page, oracleOf);
    await page.goto('/no-coi-harness.html');
    await page.evaluate(async (root) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      (globalThis as Record<string, unknown>).__zlibScenario = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
    }, root);
  });
  test.afterAll(async () => {
    await page.evaluate(() =>
      ((globalThis as Record<string, unknown>).__zlibScenario as { dispose(): void }).dispose(),
    );
    await page.close();
  });

  for (const step of STEPS) {
    test(`${step.id} ${step.title} — today pinned; ${GREEN_BY}`, async () => {
      test.setTimeout(300_000);
      const s = oracleOf().get(step.id);
      if (s === undefined) throw new Error(`no oracle for ${step.id}`);
      const rifty = await inSdk(step);
      expect(rifty).toEqual(PINS[step.id]);
      const node = { ...pinOf(observed(s.node)), status: 'exited', failure: null };
      expect(rifty, 'the pin is a gap against live Node').not.toEqual(node);
    });
  }
});
