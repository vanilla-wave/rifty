import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import {
  entryPrograms,
  fatalPrograms,
  nodeFileDump,
  nodeFileExpected,
  nodeFileNormalized,
  nodeFileVerdict,
  runNodeFileOracle,
} from './fixtures/node-file-programs.ts';

// Goal node-file-entry-parity acceptance carrier, COI Workbench host (kernel
// child): each program in its own project dir `nf/<name>`. The shell has no
// `2>`, so a rifty `node` runner spawns `node <argv>` there with piped stdio
// (as the oracle) and prints both streams, status and its root as one JSON
// line. Normalization: `nodeFileExpected`. no-COI twin:
// tests/no-coi/node-file-parity.spec.ts.

const programs = [...entryPrograms, ...fatalPrograms];
const RUNNER = `const { spawn } = require('node:child_process');
const [dir, ...argv] = process.argv.slice(2);
const cwd = require('node:path').resolve(dir);
const child = spawn('node', argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
child.on('close', (exitCode) => {
  process.stdout.write('@@NF' + JSON.stringify({ root: cwd, stdout, stderr, exitCode }) + 'NF@@\\n');
});
`;

test('node <file> matches Node (COI Workbench)', async ({ page }) => {
  test.setTimeout(900_000);
  const dump: unknown[] = [];
  const oracles = new Map<string, Awaited<ReturnType<typeof runNodeFileOracle>>>();
  for (const program of programs) oracles.set(program.name, await runNodeFileOracle(program));
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-node-file-parity',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    // `node` needs the package-tree readiness stamp that an install publishes.
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const version = await execLine(page, 'node -p process.version');
    const riftyVersion = version.out.match(/v\d+\.\d+\.\d+/u)?.[0] ?? version.out;
    // The template root is `"type": "module"`; a typeless nearest package.json
    // restores the oracle's no-package.json semantics (CJS with ESM syntax detection).
    await writeOwnerFile(page, '/scratch/nf/package.json', '{}\n');
    await writeOwnerFile(page, '/scratch/nf/runner.cjs', RUNNER);
    for (const program of programs) {
      const dir = `/scratch/nf/${program.name}`;
      await writeOwnerFile(page, `${dir}/.keep`, '');
      for (const [path, content] of Object.entries(program.files)) {
        await writeOwnerFile(page, `${dir}/${path}`, content);
      }
      const run = await execLine(
        page,
        `node nf/runner.cjs nf/${program.name} ${program.argv.join(' ')}`,
      );
      const json = /@@NF(.*)NF@@/su.exec(run.out)?.[1];
      if (json === undefined)
        throw new Error(`${program.name}: runner printed no result\n${run.out}`);
      const observed = JSON.parse(json) as {
        root: string;
        stdout: string;
        stderr: string;
        exitCode: number;
      };
      const oracle = oracles.get(program.name);
      if (oracle === undefined) throw new Error(`missing oracle for ${program.name}`);
      const expected = nodeFileExpected(oracle, riftyVersion);
      const actual = nodeFileNormalized(observed, observed.root);
      dump.push({ program, expected, actual });
      nodeFileVerdict(expect, 'COI', { program, expected, actual });
    }
  } finally {
    nodeFileDump('COI', dump);
    await closeOwner(page);
  }
});
