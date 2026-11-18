/**
 * The guest realm is the guest's: every lookup the run makes after guest code
 * can be poisoned there (ADR-0557 §5). What the HOST owes is narrower than
 * Node parity and holds unconditionally (Acceptance 16 → I3):
 *
 *  - `runCode` resolves — a guest can never make the host report an
 *    infrastructure failure of its own;
 *  - it settles well inside the deadline — no guest can hang the call;
 *  - a run that Node failed never looks clean: the guest's own diagnostic, or
 *    the host's own line when the guest broke its runtime's reporting.
 *
 * Node's exact status needs the guest's runtime intact. A guest that poisons
 * the status machinery itself gets its own answer; those cases are listed
 * separately and declared in `docs/public/compat/isolate-host.md`.
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { nodeEval } from './support.ts';

const ITERATOR = 'const it = Object.getPrototypeOf([][Symbol.iterator]());';

/** Poisoned or replaced, but the runtime's own status path stays intact. */
const FAITHFUL: readonly { readonly label: string; readonly code: string }[] = [
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
    label: 'TextEncoder replaced',
    code: "globalThis.TextEncoder = function () { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'Uint8Array poisoned',
    code: "globalThis.Uint8Array = function () { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'TypedArray.prototype.slice poisoned',
    code: "Object.getPrototypeOf(Uint8Array.prototype).slice = function () { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'Uint8Array.prototype.slice mutes output',
    code: "Uint8Array.prototype.slice = function () { return new Uint8Array(0) }; throw new Error('x')",
  },
  {
    label: 'Uint8Array.prototype.set poisoned',
    code: "Uint8Array.prototype.set = function () { throw new Error('boom') }; throw new Error('x')",
  },
  {
    label: 'String.prototype.charCodeAt poisoned',
    code: "String.prototype.charCodeAt = () => { throw new Error('boom') }; throw new Error('x')",
  },
  { label: 'String replaced', code: "String = () => ''; throw new Error('x')" },
  {
    label: 'String replaced, throw from a timer',
    code: "String = () => ''; setTimeout(() => { throw new Error('x') }, 1)",
  },
  {
    label: 'array iterator throws',
    code: `${ITERATOR} it.next = () => { throw new Error('boom') }; throw new Error('x')`,
  },
  {
    label: 'array iterator throws, throw from a timer',
    code: `${ITERATOR} it.next = () => { throw new Error('boom') }; setTimeout(() => { throw new Error('x') }, 1)`,
  },
  {
    label: 'array iterator ends early',
    code: `${ITERATOR} it.next = () => ({ done: true }); throw new Error('x')`,
  },
  {
    label: 'Array.prototype[Symbol.iterator] replaced',
    code: "Array.prototype[Symbol.iterator] = function* () {}; throw new Error('x')",
  },
  { label: 'non-Error throw with no prototype', code: 'throw Object.create(null)' },
  { label: 'forged exit signal', code: "throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 0 }" },
  {
    label: 'forged exit signal through Object.prototype',
    code: "Object.defineProperty(Object.prototype, 'code', { get() { return 'RIFTY_PROCESS_EXIT' } }); Object.prototype.exitCode = 0; throw new Error('x')",
  },
  {
    label: 'forged exit signal out of range',
    code: "throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 300 }",
  },
  {
    label: "'exit' listener throws a bare object",
    code: "process.on('exit', () => { throw Object.create(null) }); console.log('a')",
  },
];

/**
 * The guest's own error text still reaches the consumer: the host's fatal path
 * goes around what these replace, down to the encoder's own primordials
 * (`text-codec.ts`). Replacing a capture here with the live member turns the
 * text into the child's generic line, so this set pins them.
 */
const KEEPS_ERROR_TEXT = new Set([
  'process.stderr.write throws',
  'process.stderr.write swallows',
  'process.stderr replaced wholesale',
  'console replaced',
  'TextEncoder replaced',
  'Uint8Array poisoned',
  'TypedArray.prototype.slice poisoned',
  'Uint8Array.prototype.slice mutes output',
  'Uint8Array.prototype.set poisoned',
  'String.prototype.charCodeAt poisoned',
]);

/**
 * The guest poisoned the very machinery that reports its status, so its run
 * answers differently from Node's. Declared in compat; the host-side promises
 * (resolves, bounded, consumer unharmed) still hold and are asserted below.
 */
const BROKEN_RUNTIME: readonly { readonly label: string; readonly code: string }[] = [
  { label: 'Number.isInteger poisoned', code: 'Number.isInteger = () => false; console.log(1)' },
  { label: 'Reflect.get poisoned', code: 'Reflect.get = () => undefined; console.log(1)' },
  {
    label: 'Object.assign poisoned',
    code: "Object.assign = () => { throw new Error('boom') }; console.log(1)",
  },
  {
    label: 'lifecycle slot forged through Reflect.get',
    code: "const rg = Reflect.get; Reflect.get = (t, k, r) => (typeof k === 'symbol' && String(k).includes('lifecycle') ? { terminal: { exitCode: 0 } } : rg(t, k, r)); throw new Error('x')",
  },
  {
    label: 'exit signal caught and mutated',
    code: 'try { process.exit(3) } catch (e) { e.exitCode = 0 }',
  },
  { label: 'status read during the diagnostic', code: 'throw { get stack() { process.exit(0) } }' },
];

describe('post-guest paths: what the host owes whatever the guest replaced', () => {
  for (const { label, code } of [...FAITHFUL, ...BROKEN_RUNTIME]) {
    it(`${label} — resolves, bounded, no host failure`, async () => {
      const started = Date.now();
      const result = await runCode(code, { timeoutMs: 3000 }).catch((error: Error) => ({
        rejected: error.message,
      }));
      // Never an infrastructure failure of the host's, and never a hang.
      expect(result).not.toHaveProperty('rejected');
      expect(Date.now() - started).toBeLessThan(3000);
      expect(JSON.stringify(result)).not.toMatch(/child\.js|dist\/|file:/);
    });
  }

  for (const { label, code } of FAITHFUL) {
    it(`${label} — status is Node's and a failure is never silent`, async () => {
      const oracle = nodeEval(code);
      const result = await runCode(code, { timeoutMs: 3000 });
      expect({ label, exitCode: result.exitCode }).toEqual({ label, exitCode: oracle.code });
      if (oracle.code !== 0) {
        expect(result.stderr.length).toBeGreaterThan(0);
        // Where the guest hid nothing, its own error is what the consumer reads.
        if (KEEPS_ERROR_TEXT.has(label)) expect(result.stderr).toContain('Error: x');
      } else {
        expect(result.stdout).toBe(oracle.stdout);
      }
    });
  }

  it('a non-Error throw is named by type, not coerced through guest code', async () => {
    const result = await runCode('throw Object.create(null)');
    expect(result.stderr).toBe('isolate-host: the run threw a non-Error value (object)\n');
    expect(result.exitCode).toBe(1);
  });

  it('a guest that breaks its status reporting is told so, not reported clean', async () => {
    // The guest's tail cannot produce a number the child accepts: the child
    // writes its own line and fails the run.
    const result = await runCode(
      `${ITERATOR} it.next = () => { throw new Error('boom') }; throw new Error('x')`,
    );
    expect(result).toEqual({
      stdout: '',
      stderr:
        'isolate-host: the run ended without a usable status (the guest broke its own runtime)\n',
      exitCode: 1,
    });
  });
});
