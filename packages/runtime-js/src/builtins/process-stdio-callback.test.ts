import { Buffer as NativeBuffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import './index.ts';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';

const sources = {
  'encoded byte and callback shape': `process.stdout.write('41','hex',function(error){
process.stdout.write(JSON.stringify({error,argc:arguments.length}));
});`,
  'binary bytes on stdout and stderr': `process.stdout.write('ff','hex');process.stderr.write('fe','hex');`,
  'write callbacks precede promises': `const events=[];
Promise.resolve().then(()=>events.push('promise'));
process.stdout.write('',()=>events.push('write'));
setTimeout(()=>process.stdout.write(JSON.stringify(events)),10);`,
};
afterEach(() => resetSyncMirror());

for (const [name, source] of Object.entries(sources))
  it(`same-realm stdio: ${name}`, async () => {
    const oracle = spawnSync(process.execPath, ['-e', source]);
    writeFileSync('/stdio-callback.cjs', source);
    const child = spawn('node', ['/stdio-callback.cjs']);
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    child.stderr.on('data', (chunk) => errors.push(NativeBuffer.from(chunk as Uint8Array)));
    child.stdout.on('data', (chunk) => {
      output.push(NativeBuffer.from(chunk as Uint8Array));
    });
    const code = await new Promise((resolve) => child.once('close', resolve));
    expect(code).toBe(0);
    expect([...NativeBuffer.concat(output)]).toEqual([...oracle.stdout]);
    expect([...NativeBuffer.concat(errors)]).toEqual([...oracle.stderr]);
  });
