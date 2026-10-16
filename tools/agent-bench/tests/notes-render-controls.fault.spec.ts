import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
test('actual Markdown programmes and open DOM/navigation preserve functional negatives', async () => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve('tools/agent-bench/tests/notes-render-controls.ts')],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (chunk: Buffer) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    log += chunk;
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  expect(code, log).toBe(0);
});
