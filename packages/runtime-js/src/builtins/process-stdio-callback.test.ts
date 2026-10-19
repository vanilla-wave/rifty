import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import './index.ts';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';

const source = `process.stdout.write('41','hex',function(error){
process.stdout.write(JSON.stringify({error,argc:arguments.length}));
});`;
afterEach(() => resetSyncMirror());

it('same-realm stdio preserves encoded bytes and invokes the write callback as Node', async () => {
  const oracle = execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' });
  writeFileSync('/stdio-callback.cjs', source);
  const child = spawn('node', ['/stdio-callback.cjs']);
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  const code = await new Promise((resolve) => child.once('close', resolve));
  expect(code).toBe(0);
  expect(output).toBe(oracle);
});
