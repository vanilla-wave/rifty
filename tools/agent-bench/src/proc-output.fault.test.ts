import { expect, it } from 'vitest';
import { runToCompletion } from './proc.ts';

it('retains real UTF-8 bytes split across ordered native stdout/stderr chunks', async () => {
  const code = `const output=Buffer.from('Ж');const error=Buffer.from('😀');process.stdout.write(output.subarray(0,1));process.stderr.write(error.subarray(0,2));setTimeout(()=>{process.stdout.write(output.subarray(1));process.stderr.write(error.subarray(2));},80);`;
  const result = await runToCompletion(process.execPath, ['-e', code], {
    cwd: process.cwd(),
    timeoutMs: 10000,
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('Ж');
  expect(result.stderr).toBe('😀');
});
