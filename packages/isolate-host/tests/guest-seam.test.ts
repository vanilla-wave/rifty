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
    // V8 errors own `stack`, so the prototype is not the lever; the own getter is.
    label: 'own stack getter throws',
    code: "const e = new Error('x'); Object.defineProperty(e, 'stack', { get() { throw new Error('boom') } }); throw e",
  },
  { label: 'non-Error throw with no prototype', code: 'throw Object.create(null)' },
  {
    label: 'forged exit signal',
    code: "throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 0 }",
  },
  {
    label: 'forged exit signal through Object.prototype',
    code: "Object.defineProperty(Object.prototype, 'code', { get() { return 'RIFTY_PROCESS_EXIT' } }); Object.prototype.exitCode = 0; throw new Error('x')",
  },
  {
    label: 'forged exit signal out of range',
    code: "throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 300 }",
  },
  {
    label: 'Error.hasInstance poisoned',
    code: "Object.defineProperty(Error, Symbol.hasInstance, { value: () => { throw new Error('boom') } }); throw new Error('x')",
  },
  {
    label: 'prepareStackTrace poisoned',
    code: "Error.prepareStackTrace = () => { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'prepareStackTrace poisoned, throw from a timer',
    code: "Error.prepareStackTrace = () => { throw new Error('boom') }; setTimeout(() => { throw new Error('x') }, 1)",
  },
  {
    label: 'TypedArray.prototype.slice poisoned',
    code: "Object.getPrototypeOf(Uint8Array.prototype).slice = function () { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'String.prototype.charCodeAt poisoned',
    code: "String.prototype.charCodeAt = () => { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'Uint8Array.prototype.slice mutes output',
    code: "Uint8Array.prototype.slice = function () { return new Uint8Array(0) }; throw new Error('x')",
  },
  {
    label: "'exit' listener throws a bare object",
    code: "process.on('exit', () => { throw Object.create(null) }); console.log('a')",
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
      // A failed run always says something on stderr: never a silent exit 1.
      if (oracle.code !== 0) expect(result.stderr.length).toBeGreaterThan(0);
    });
  }
});
