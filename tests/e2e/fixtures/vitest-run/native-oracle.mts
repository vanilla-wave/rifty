import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vitestProject } from './project.ts';

const cwd = await mkdtemp(join(tmpdir(), 'rifty-vitest-native-'));
for (const [path, source] of Object.entries(vitestProject)) {
  await mkdir(dirname(join(cwd, path)), { recursive: true });
  await writeFile(join(cwd, path), source);
}
const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
  cwd,
  encoding: 'utf8',
  timeout: 180_000,
});
assert.equal(install.status, 0, install.stderr);
const runs: { command: string; failing: boolean; status: number | null }[] = [];
for (const failing of [true, false]) {
  if (!failing)
    await writeFile(
      join(cwd, 'src/sum.test.ts'),
      vitestProject['src/sum.test.ts'].replace('toBe(4)', 'toBe(3)'),
    );
  for (const args of [
    ['run'],
    ['run', '--pool=forks'],
    ['run', '--pool=threads'],
    ['run', '--reporter=verbose'],
    ['npm', 'test'],
  ]) {
    const npm = args[0] === 'npm';
    const result = spawnSync(
      npm ? 'npm' : process.execPath,
      npm ? ['test'] : ['node_modules/vitest/vitest.mjs', ...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: 90_000,
      },
    );
    const output = result.stdout + result.stderr;
    assert.equal(result.status, failing ? 1 : 0, output);
    assert.match(output, failing ? /1 failed/ : /2 passed/);
    assert.doesNotMatch(output, /CONFIG_INCLUDE_WAS_IGNORED/);
    if (failing) {
      assert.match(output, /1 passed/);
      assert.match(output, /expected 3 to be 4/);
      assert.match(output, /- Expected/);
      assert.match(output, /\+ Received/);
      assert.match(output, /-\s+4/);
      assert.match(output, /\+\s+3/);
    }
    if (failing || args.includes('--reporter=verbose')) assert.match(output, /src\/sum\.test\.ts/);
    if (args.includes('--reporter=verbose')) {
      assert.match(output, /adds numbers/);
      assert.match(output, /reveals a failing expectation/);
    }
    runs.push({
      command: npm ? 'npm test' : `vitest ${args.join(' ')}`,
      failing,
      status: result.status,
    });
  }
}
console.log(JSON.stringify({ node: process.version, cwd, runs }, null, 2));
