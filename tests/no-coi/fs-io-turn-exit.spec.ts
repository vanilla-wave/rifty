import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_IO_TURN_EXIT_CHILD } from '../browser-unit/fixtures/fs-io-turn-programs.ts';
import { expect, test } from './fixtures/test.ts';

// Unit runtime-js/fs-callbacks-io-turn, no-COI SDK host: the process end runs a submitted
// write without its callback, as Node joins its threadpool. The carrier's parent program
// spawns these children (Workbench); no-COI Node children need a controlling Service
// Worker, so here each child is one sandbox run and the file is read after it.

const root = process.cwd().replaceAll('\\', '/');
const MODES = ['exit', 'throw', 'reject', 'exit-listener', 'exit-in-callback'];

function oracle(mode: string): { exitCode: number | null; stdout: string; file: string | null } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'fs-io-turn-exit-')));
  try {
    writeFileSync(join(dir, 'child.js'), FS_IO_TURN_EXIT_CHILD);
    const r = spawnSync(process.execPath, ['child.js', mode], { cwd: dir, encoding: 'utf8' });
    let file: string | null = null;
    try {
      file = readFileSync(join(dir, 'e.txt'), 'utf8');
    } catch {}
    return { exitCode: r.status, stdout: r.stdout, file };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('process end with a write submitted leaves the file Node leaves (no-COI SDK)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const expected = MODES.map((mode) => ({ mode, ...oracle(mode) }));
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(
    async ({ root, child, modes }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      await sandbox.fs.writeFile('/fsexit/package.json', '{}\n');
      await sandbox.fs.writeFile('/fsexit/child.js', child);
      const rows = [];
      for (const mode of modes) {
        const r = await sandbox.project({ root: '/fsexit' }).run(`node child.js ${mode}`)
          .completion;
        let file: string | null = null;
        try {
          file = await sandbox.fs.readFile('/fsexit/e.txt', 'utf8');
          await sandbox.fs.rm('/fsexit/e.txt');
        } catch {}
        rows.push({ mode, exitCode: r.exitCode, stdout: r.stdout, file });
      }
      return rows;
    },
    { root, child: FS_IO_TURN_EXIT_CHILD, modes: MODES },
  );
  expect(observed).toEqual(expected);
});
