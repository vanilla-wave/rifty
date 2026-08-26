import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { validateChildFsArtifact } from '../../tools/perf/src/child-fs-artifact.mjs';
import { assertChildFsPortFree } from '../../tools/perf/src/child-fs-runner.mjs';

const execute = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('free-port probe failed');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}

test('bench:child-fs CLI runs both real lanes and publishes canonical evidence', async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const directory = mkdtempSync(join(tmpdir(), 'rifty-child-fs-cli-'));
  const out = join(directory, 'artifact.json');
  const port = await freePort();
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const startedAt = Date.now();
  try {
    await execute(
      'pnpm',
      ['bench:child-fs', '--', '--runs', '1', '--out', out, '--port', String(port)],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 840_000,
      },
    );
    const bytes = readFileSync(out, 'utf8');
    const artifact = validateChildFsArtifact(JSON.parse(bytes));
    expect(bytes).toBe(`${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact).toMatchObject({
      browserVersion: browser.version(),
      gitSha,
      runs: 1,
    });
    expect(Date.parse(artifact.generatedAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(artifact.generatedAt)).toBeLessThanOrEqual(Date.now());
    expect(artifact.samples.map(({ lane, ordinal }) => `${lane}:${ordinal}`)).toEqual([
      'product-coi:1',
      'in-realm:1',
    ]);
    expect(artifact.samples.map(({ vite }) => vite.transformedModules)).toEqual([2180, 2180]);
    await expect(assertChildFsPortFree(port)).resolves.toBeUndefined();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
