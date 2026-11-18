/**
 * What the run does after guest code must not go through anything the guest can
 * replace (ADR-0557 §5): a guest cannot forge, mute or redirect an
 * infrastructure failure, nor change its own status. Oracle: live `node -e`.
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { nodeEval } from './support.ts';

const CASES: readonly { readonly label: string; readonly code: string }[] = [
  {
    label: 'process.stderr.write throws',
    code: "process.stderr.write = () => { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'process.stderr.write swallows',
    code: "process.stderr.write = () => true; throw new Error('x')",
  },
  {
    label: 'process.stderr replaced wholesale',
    code: "process.stderr = { write: () => { throw new Error('boom') } }; throw new Error('x')",
  },
  { label: 'process.exit replaced', code: 'process.exit = () => {}; console.log(1)' },
  {
    label: 'process.exit throws',
    code: "process.exit = () => { throw new Error('boom') }; console.log(1)",
  },
  { label: 'process replaced wholesale', code: "process = {}; console.log('after')" },
  {
    label: 'console replaced',
    code: "console = { log: () => { throw new Error('boom') } }; throw new Error('x')",
  },
  {
    label: 'Error.prototype.stack poisoned',
    code: "Object.defineProperty(Error.prototype, 'stack', { get() { throw new Error('boom') } }); throw new Error('x')",
  },
  {
    label: 'TextEncoder replaced',
    code: "globalThis.TextEncoder = function () { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'Uint8Array poisoned',
    code: "globalThis.Uint8Array = function () { throw new Error('boom') }; throw new Error('x')",
  },
];

describe('post-guest paths do not trust guest-replaceable objects', () => {
  for (const { label, code } of CASES) {
    it(label, async () => {
      const oracle = nodeEval(code);
      const result = await runCode(code).catch((error: Error) => ({
        rejected: error.message,
        stdout: '',
        stderr: '',
        exitCode: -1 as number | null,
      }));
      expect(result).not.toHaveProperty('rejected');
      // The status is Node's, and the host never reports its own failure instead.
      expect({ label, exitCode: result.exitCode }).toEqual({ label, exitCode: oracle.code });
      // Never the host reporting its own failure instead of the guest's.
      expect(result.stderr).not.toContain('isolate-host child failed');
      expect(result.stderr).not.toMatch(/child\.js|dist\/|file:/);
      if (oracle.code === 0) expect(result.stdout).toBe(oracle.stdout);
      // A thrown guest error still reaches stderr, whatever it replaced.
      if (code.includes("throw new Error('x')")) expect(result.stderr).toContain('Error: x');
    });
  }
});
