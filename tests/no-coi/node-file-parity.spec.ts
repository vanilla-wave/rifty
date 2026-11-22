import {
  type NodeFileOutcome,
  entryPrograms,
  fatalPrograms,
  nodeFileDump,
  nodeFileExpected,
  nodeFileNormalized,
  nodeFileVerdict,
  runNodeFileOracle,
} from '../browser-unit/fixtures/node-file-programs.ts';
import { expect, test } from './fixtures/test.ts';

// Goal node-file-entry-parity acceptance carrier, no-COI SDK host: one
// sandbox, each program in its own project root, run as
// `project({ root }).run('node <argv>')` against live `node <argv>` over the
// same files. Comparison: `nodeFileVerdict`. COI twin:
// tests/browser-unit/node-file-parity.spec.ts.

const root = process.cwd().replaceAll('\\', '/');
const programs = [...entryPrograms, ...fatalPrograms];

test('node <file> matches Node (no-COI SDK)', async ({ page }) => {
  test.setTimeout(900_000);
  const oracles = await Promise.all(programs.map((program) => runNodeFileOracle(program)));
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(
    async ({ root, programs }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        const results: { root: string; outcome: NodeFileOutcome }[] = [];
        let version = '';
        for (const program of programs) {
          const projectRoot = `/nf/${program.name}`;
          await sandbox.fs.writeFile(`${projectRoot}/.keep`, '');
          for (const [path, content] of Object.entries(program.files)) {
            await sandbox.fs.writeFile(`${projectRoot}/${path}`, content);
          }
          const project = sandbox.project({ root: projectRoot });
          if (version === '') {
            version = (await project.run('node -p process.version').completion).stdout.trim();
          }
          const done = await project.run(`node ${program.argv.join(' ')}`).completion;
          results.push({
            root: projectRoot,
            outcome: { stdout: done.stdout, stderr: done.stderr, exitCode: done.exitCode },
          });
        }
        return { version, results };
      } finally {
        sandbox.dispose();
      }
    },
    { root, programs },
  );
  const rows = programs.map((program, index) => {
    const oracle = oracles[index];
    const result = observed.results[index];
    if (oracle === undefined || result === undefined) throw new Error(`missing ${program.name}`);
    return {
      program,
      expected: nodeFileExpected(oracle, observed.version),
      actual: nodeFileNormalized(result.outcome, result.root),
    };
  });
  await test.info().attach('node-file', {
    body: JSON.stringify({ node: process.version, rifty: observed.version, rows }, null, 2),
    contentType: 'application/json',
  });
  nodeFileDump('no-COI', rows);
  for (const row of rows) nodeFileVerdict(expect, 'no-COI', row);
});
