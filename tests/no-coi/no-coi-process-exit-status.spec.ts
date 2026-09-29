import { expect, test } from '@playwright/test';
import {
  type ProcessLifecycleCase,
  lifecycleRows,
  processLifecycleCases,
  runLifecycleOracle,
} from '../browser-unit/fixtures/process-lifecycle-cases.ts';

// ADR-0445 in-process hosts (no control port): the no-COI project command and
// runBin report the process's terminal status as live Node does. Each program
// runs verbatim in Node (the oracle) and in the no-COI toolchain realm; status,
// `L|` rows and the loud marker must match. A throwing `uncaughtException`
// listener is 7, never the natural exit's 0 (the exit request only reached the
// absent control port).

const root = process.cwd().replaceAll('\\', '/');
const EXIT_ROW = "process.on('exit', (c) => console.log('L|exit', c, process.exitCode));";
const LISTENER_THROWS =
  "process.on('uncaughtException', () => { throw new Error('LISTENER-THREW'); });";

const shared = (name: string): ProcessLifecycleCase => {
  const found = processLifecycleCases.find((testCase) => testCase.name === name);
  if (found === undefined) throw new Error(`missing shared lifecycle case ${name}`);
  return found;
};

function program(name: string, source: string, fatal?: string): ProcessLifecycleCase {
  return {
    name,
    files: { [`${name}.cjs`]: source },
    nodeArgv: [`${name}.cjs`],
    ...(fatal === undefined ? {} : { fatal }),
  };
}

const listenerThrowRejection = program(
  'listener-throw-rejection',
  `${EXIT_ROW}\n${LISTENER_THROWS}\nPromise.reject(new Error('rejected'));`,
  'LISTENER-THREW',
);
const listenerThrowTimer = program(
  'listener-throw-timer',
  `${EXIT_ROW}\n${LISTENER_THROWS}
setTimeout(() => { throw new Error('timer'); }, 0);
setTimeout(() => console.log('L|never'), 50);`,
  'LISTENER-THREW',
);
const listenerThrowLive = program(
  'listener-throw-live-interval',
  `${LISTENER_THROWS}\nsetInterval(() => {}, 1000);\nsetTimeout(() => { throw new Error('timer'); }, 0);`,
  'LISTENER-THREW',
);
// ADR-0445: no timer of a process runs after its terminal — neither one an
// 'exit' listener arms nor an unref'd one.
const unrefInterval = program(
  'unref-interval',
  `${EXIT_ROW}\nsetInterval(() => console.log('L|tick'), 20).unref();`,
);

const commandCases: readonly ProcessLifecycleCase[] = [
  listenerThrowRejection,
  listenerThrowTimer,
  listenerThrowLive,
  {
    name: 'eval-listener-throw',
    files: {},
    nodeArgv: [
      '-e',
      "process.on('uncaughtException',()=>{throw new Error('LISTENER-THREW')});setTimeout(()=>{throw new Error('timer')},0)",
    ],
    line: `node -e "process.on('uncaughtException',()=>{throw new Error('LISTENER-THREW')});setTimeout(()=>{throw new Error('timer')},0)"`,
    fatal: 'LISTENER-THREW',
  },
  shared('exit-in-uncaught-handler'),
  shared('fatal-rejection'),
  shared('natural-exit-code'),
  shared('exit-listener-timer'),
  unrefInterval,
];

const binCases: readonly ProcessLifecycleCase[] = [
  listenerThrowRejection,
  listenerThrowTimer,
  shared('exit-listener-reassign'),
  shared('exit-reentrant'),
  shared('natural-exit'),
  shared('exit-listener-timer'),
  unrefInterval,
  shared('fatal-rejection'),
];

/** Same program behind a `.bin` launcher, as npm links it (Node runs the shim). */
function asBin(testCase: ProcessLifecycleCase): ProcessLifecycleCase {
  const [file] = Object.keys(testCase.files);
  const source = file === undefined ? undefined : testCase.files[file];
  if (file === undefined || source === undefined) throw new Error(`${testCase.name} has no file`);
  const bin = `exit-${testCase.name}`;
  return {
    name: testCase.name,
    files: {
      [`node_modules/${bin}/cli.cjs`]: source,
      [`node_modules/.bin/${bin}`]: `#!/usr/bin/env node\nimport('../${bin}/cli.cjs');\n`,
    },
    nodeArgv: [`node_modules/.bin/${bin}`],
    ...(testCase.fatal === undefined ? {} : { fatal: testCase.fatal }),
  };
}

interface Observed {
  readonly exit: number | null | 'timeout';
  readonly stdout: string;
  readonly stderr: string;
}

async function expectNodeStatus(
  testCase: ProcessLifecycleCase,
  observed: Observed,
  label: string,
): Promise<void> {
  const oracle = await runLifecycleOracle(testCase);
  if (testCase.fatal !== undefined) expect(oracle.stderr).toContain(testCase.fatal);
  expect(
    {
      exit: observed.exit,
      rows: lifecycleRows(observed.stdout),
      fatal: testCase.fatal === undefined || observed.stderr.includes(testCase.fatal),
    },
    `${label} ${testCase.name} vs Node ${oracle.version}\n${observed.stdout}\n${observed.stderr}`,
  ).toEqual({ exit: oracle.code, rows: lifecycleRows(oracle.stdout), fatal: true });
}

for (const testCase of commandCases) {
  test(`project command reports Node's status: ${testCase.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, files, line }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        try {
          await sandbox.fs.writeFile('/exit-status/.keep', '');
          for (const [path, content] of Object.entries(files)) {
            await sandbox.fs.writeFile(`/exit-status/${path}`, content);
          }
          const run = sandbox.project({ root: '/exit-status' }).run(line);
          const timeout = new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 20_000),
          );
          const outcome = await Promise.race([run.completion, timeout]);
          if (outcome === 'timeout') return { exit: 'timeout' as const, stdout: '', stderr: '' };
          return {
            exit: outcome.status === 'exited' ? outcome.exitCode : null,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
          };
        } finally {
          sandbox.dispose();
        }
      },
      {
        root,
        files: testCase.files,
        line: testCase.line ?? `node ${testCase.nodeArgv.join(' ')}`,
      },
    );
    await expectNodeStatus(testCase, observed, 'project command');
  });
}

for (const testCase of binCases.map(asBin)) {
  test(`runBin reports Node's status: ${testCase.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, files, binPath }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        let stdout = '';
        let stderr = '';
        const off = sandbox.runtime.on((event: { type: string; chunk?: string }) => {
          if (event.type === 'stdout') stdout += event.chunk ?? '';
          if (event.type === 'stderr') stderr += event.chunk ?? '';
        });
        try {
          for (const [path, content] of Object.entries(files)) {
            await sandbox.fs.writeFile(`/exit-status/${path}`, content);
          }
          const timeout = new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 20_000),
          );
          const outcome = await Promise.race([
            sandbox.toolchain.runBin({ cwd: '/exit-status', binPath, args: [] }),
            timeout,
          ]);
          // A dead process's timer must not print after runBin returned.
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { exit: outcome === 'timeout' ? outcome : outcome.exitCode, stdout, stderr };
        } finally {
          off();
          sandbox.dispose();
        }
      },
      { root, files: testCase.files, binPath: `/exit-status/${testCase.nodeArgv[0]}` },
    );
    await expectNodeStatus(testCase, observed, 'runBin');
  });
}

// Each invocation is its own Node process: a finished one's listeners never run
// in the next (its 'exit' listener neither prints nor sets the next status; its
// 'uncaughtException' listener does not handle the next one's rejection).
const firstProcess = program(
  'first-listeners',
  `process.on('exit', (c) => { console.log('L|exit-first', c); process.exitCode = 5; });
process.on('uncaughtException', (e) => console.log('L|caught-first', e.message));
console.log('L|first');`,
);
const secondProcess = program(
  'second-rejects',
  `${EXIT_ROW}\nconsole.log('L|second');\nPromise.reject(new Error('second-rejected'));`,
  'second-rejected',
);

for (const host of ['project command', 'runBin'] as const) {
  test(`${host} ends each process's listeners with it`, async ({ page }) => {
    test.setTimeout(120_000);
    const runs =
      host === 'runBin'
        ? [asBin(firstProcess), asBin(secondProcess)]
        : [firstProcess, secondProcess];
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, host, runs }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        let stdout = '';
        const off = sandbox.runtime.on((event: { type: string; chunk?: string }) => {
          if (event.type === 'stdout') stdout += event.chunk ?? '';
        });
        try {
          await sandbox.fs.writeFile('/exit-status/.keep', '');
          for (const run of runs) {
            for (const [path, content] of Object.entries(run.files)) {
              await sandbox.fs.writeFile(`/exit-status/${path}`, content);
            }
          }
          const results: { exit: number | null; stdout: string }[] = [];
          for (const run of runs) {
            if (host === 'runBin') {
              stdout = '';
              const { exitCode } = await sandbox.toolchain.runBin({
                cwd: '/exit-status',
                binPath: `/exit-status/${run.nodeArgv[0]}`,
                args: [],
              });
              await new Promise((resolve) => setTimeout(resolve, 50));
              results.push({ exit: exitCode, stdout });
            } else {
              const done = await sandbox
                .project({ root: '/exit-status' })
                .run(`node ${run.nodeArgv[0]}`).completion;
              results.push({
                exit: done.status === 'exited' ? done.exitCode : null,
                stdout: done.stdout,
              });
            }
          }
          return results;
        } finally {
          off();
          sandbox.dispose();
        }
      },
      { root, host, runs },
    );
    const oracle: { exit: number | null; rows: string[] }[] = [];
    for (const run of runs) {
      const node = await runLifecycleOracle(run);
      if (run.fatal !== undefined) expect(node.stderr).toContain(run.fatal);
      oracle.push({ exit: node.code, rows: lifecycleRows(node.stdout) });
    }
    expect(
      observed.map((run) => ({ exit: run.exit, rows: lifecycleRows(run.stdout) })),
      `${host} vs Node`,
    ).toEqual(oracle);
  });
}

// Honest gap (draft `distribution/no-coi-command-unhandled-rejection-exit`): an
// exited process whose server still listens cannot be abandoned by a reused
// realm, so the command replaces it loudly instead of reporting a clean exit.
test('project command replaces the realm when an exited process leaves a listening server', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(
    async ({ root }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        await sandbox.fs.writeFile(
          '/exit-status/server-exit.cjs',
          "const server = require('node:http').createServer((q, r) => r.end('alive'));\n" +
            'server.listen(5197, () => setTimeout(() => process.exit(2), 10));',
        );
        const project = sandbox.project({ root: '/exit-status' });
        const exited = await project.run('node server-exit.cjs').completion;
        const next = await project.run('echo next').completion;
        return {
          exited: {
            status: exited.status,
            exitCode: exited.exitCode,
            worker: exited.worker,
            error: exited.error?.message,
          },
          next: { status: next.status, exitCode: next.exitCode, stdout: next.stdout },
        };
      } finally {
        sandbox.dispose();
      }
    },
    { root },
  );
  expect(observed).toEqual({
    exited: { status: 'failed', exitCode: null, worker: 'replaced', error: 'process.exit(2)' },
    next: { status: 'exited', exitCode: 0, stdout: 'next\n' },
  });
});
