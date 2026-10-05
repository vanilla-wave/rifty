import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
test('physical command receipts reject a forged judge and accept correct behavior in every origin', async () => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve('tools/agent-bench/tests/trusted-origin.ts')],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (chunk: Buffer) => {
    log += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    log += chunk;
    process.stderr.write(chunk);
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  expect(code, log).toBe(0);
});
