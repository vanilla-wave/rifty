import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
for (const [name, script, args] of [
  ['real semantic captions/opaque output preserve functional negatives', 'caption-controls.ts', []],
  [
    'all origins accept captions; captured programme reaches full own-COI workflow',
    'caption-origin-controls.ts',
    ['tools/agent-bench/tests/fixtures/csv-pilot-programme2.json.gz'],
  ],
] as const) {
  test(name, async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve('tools/agent-bench/tests', script), ...args],
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
}
