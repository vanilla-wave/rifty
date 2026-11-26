/**
 * The cost of a store that owns its bytes (compat isolate-host.md "File write
 * memory"): one write of N bytes from a buffer needs up to 2N of isolate memory
 * during the call. 50 MiB under 96 MiB fails loudly at the write and leaves the
 * sandbox usable; under 160 MiB it fits. Was: passed under 96 (the file was the
 * program's buffer, mutable after the write).
 */
import { expect, it } from 'vitest';
import { createSandbox, runCode } from '../src/index.ts';

const write50 = (path: string) =>
  `const fs = require('node:fs');
const b = new Uint8Array(50 * 1024 * 1024);
fs.writeFileSync('${path}', b);
console.log('wrote', fs.statSync('${path}').size);`;
const oom = {
  stdout: '',
  stderr: expect.stringMatching(/^RangeError: Array buffer allocation failed\n {4}at /),
  exitCode: 1,
};

it('runCode: one 50 MiB write needs more than 96 MiB, fits 160 MiB', async () => {
  expect(await runCode(write50('/big'), { memoryLimitMb: 96, timeoutMs: 60_000 })).toEqual(oom);
  expect(await runCode(write50('/big'), { memoryLimitMb: 160, timeoutMs: 60_000 })).toEqual({
    stdout: 'wrote 52428800\n',
    stderr: '',
    exitCode: 0,
  });
});

it('sandbox exec: the refused write names its error, the sandbox stays usable', async () => {
  const sandbox = await createSandbox();
  try {
    await sandbox.writeFile('/workspace/w.js', write50('/workspace/big'));
    const refused = await sandbox.exec('/workspace/w.js', { memoryLimitMb: 96, timeoutMs: 60_000 });
    expect({ stdout: refused.stdout, stderr: refused.stderr, exitCode: refused.exitCode }).toEqual(
      oom,
    );
    expect(refused.termination).toBeUndefined();
    expect((await sandbox.list()).map((e) => e.name)).toEqual(['w.js']);
    const fits = await sandbox.exec('/workspace/w.js', { memoryLimitMb: 160, timeoutMs: 60_000 });
    expect(fits).toMatchObject({ stdout: 'wrote 52428800\n', stderr: '', exitCode: 0 });
    expect(fits.stateRefused).toBeUndefined();
    expect(await sandbox.list()).toContainEqual({ name: 'big', type: 'file', size: 52428800 });
  } finally {
    await sandbox.destroy();
  }
});

it("a refused 'wx' write leaves no file: the copy comes before open creates it", async () => {
  const code = `const fs = require('node:fs');
const b = new Uint8Array(50 * 1024 * 1024);
try { fs.writeFileSync('/big', b, { flag: 'wx' }); } catch (e) { console.log(e.name, fs.existsSync('/big')); }`;
  expect(await runCode(code, { memoryLimitMb: 96, timeoutMs: 60_000 })).toEqual({
    stdout: 'RangeError false\n',
    stderr: '',
    exitCode: 0,
  });
});
