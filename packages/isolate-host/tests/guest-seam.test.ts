/**
 * The guest realm is the guest's: every lookup the run makes after guest code
 * can be poisoned there (ADR-0557 §5). What the HOST owes is narrower than Node
 * parity and holds for every case in this file (Acceptance 16 → I3):
 *
 *  - `runCode` resolves — a guest can never make the host report an
 *    infrastructure failure of its own;
 *  - the call settles within the deadline it was given — a guest can hang its
 *    own run (the host then kills it), never the consumer's call;
 *  - the host's own transport never invents a clean status: the run's status
 *    crosses as one primitive, and one the child cannot use is a failed run
 *    (exit 1) — never a clean one;
 *  - stderr stays the program's own bytes; the host adds no text to it.
 *
 * Node's exact status needs the guest's runtime intact. A guest that poisons
 * the status machinery itself gets its own answer, so `BROKEN_RUNTIME` pins
 * exactly what each such case reads — including the two that read clean for a
 * run Node failed. Both tables are declared in
 * `docs/public/compat/isolate-host.md`.
 */
import { describe, expect, it } from 'vitest';
import { type RunCodeResult, runCode } from '../src/index.ts';
import { nodeEval } from './support.ts';

const ITERATOR = 'const it = Object.getPrototypeOf([][Symbol.iterator]());';
const TIMEOUT_MS = 3000;
/** I4: the call settles within the deadline plus the host's own grace. */
const SETTLE_BY_MS = TIMEOUT_MS + 1000;

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
  // The status crosses as a number, so a promise resolution never looks up
  // `then` in this realm: a forged `Object.prototype.then` cannot rewrite it.
  {
    label: 'Object.prototype.then forged to resolve clean',
    code: "Object.prototype.then = function (r) { delete Object.prototype.then; r({ code: 0, diagnosed: false }) }; throw new Error('x')",
  },
  {
    label: 'Object.prototype.then swallows every thenable',
    code: "Object.prototype.then = function () {}; throw new Error('x')",
  },
  {
    label: 'Object.prototype.then swallows, clean run',
    code: 'Object.prototype.then = function () {}; console.log(1)',
  },
  {
    label: 'Promise.prototype.then poisoned',
    code: "Promise.prototype.then = function () { throw new Error('boom') }; throw new Error('x')",
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
 * (`text-codec.ts`). Replacing a capture here with the live member drops the
 * text, so this set pins them.
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
  'Object.prototype.then forged to resolve clean',
  'Object.prototype.then swallows every thenable',
  'Promise.prototype.then poisoned',
]);

/**
 * The guest poisoned the machinery that reports its own status, so its run
 * answers differently from Node's. `reads` is what the host answers instead —
 * each row asserted exactly, so a new divergence cannot hide inside the class.
 * `cleanForAFailure` marks the only concession: a run Node failed that reads as
 * a clean success, because the guest forged its runtime's own terminal.
 */
const BROKEN_RUNTIME: readonly {
  readonly label: string;
  readonly code: string;
  readonly reads: Pick<RunCodeResult, 'exitCode'> & {
    readonly termination?: string;
    /** The guest broke its diagnostic path: nothing reached stderr, and the host adds nothing. */
    readonly stderr?: '';
  };
  readonly cleanForAFailure?: true;
}[] = [
  {
    label: 'Number.isInteger poisoned',
    code: 'Number.isInteger = () => false; console.log(1)',
    reads: { exitCode: 1 },
  },
  {
    label: 'Reflect.get poisoned',
    code: 'Reflect.get = () => undefined; console.log(1)',
    reads: { exitCode: 1 },
  },
  {
    label: 'Object.assign poisoned',
    code: "Object.assign = () => { throw new Error('boom') }; console.log(1)",
    reads: { exitCode: 1 },
  },
  {
    label: 'status read during the diagnostic',
    code: 'throw { get stack() { process.exit(0) } }',
    reads: { exitCode: 1 },
  },
  // The guest forged its runtime's own terminal: the run reads as the exit the
  // guest chose. Declared, and the only direction that can read clean.
  {
    label: 'lifecycle slot forged through Reflect.get',
    code: "const rg = Reflect.get; Reflect.get = (t, k, r) => (typeof k === 'symbol' && String(k).includes('lifecycle') ? { terminal: { exitCode: 0 } } : rg(t, k, r)); throw new Error('x')",
    reads: { exitCode: 0 },
    cleanForAFailure: true,
  },
  {
    label: 'exit signal caught and mutated',
    code: 'try { process.exit(3) } catch (e) { e.exitCode = 0 }',
    reads: { exitCode: 0 },
    cleanForAFailure: true,
  },
  // Broke its own diagnostic: Node's status, but no text arrives and the host
  // writes none of its own (goal.md Decisions: stderr carries guest bytes only).
  {
    label: 'String replaced',
    code: "String = () => ''; throw new Error('x')",
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'String replaced, throw from a timer',
    code: "String = () => ''; setTimeout(() => { throw new Error('x') }, 1)",
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'array iterator throws',
    code: `${ITERATOR} it.next = () => { throw new Error('boom') }; throw new Error('x')`,
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'array iterator throws, throw from a timer',
    code: `${ITERATOR} it.next = () => { throw new Error('boom') }; setTimeout(() => { throw new Error('x') }, 1)`,
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'array iterator ends early',
    code: `${ITERATOR} it.next = () => ({ done: true }); throw new Error('x')`,
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'Array.prototype[Symbol.iterator] replaced',
    code: "Array.prototype[Symbol.iterator] = function* () {}; throw new Error('x')",
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'Object.prototype.then forged and the array iterator muted',
    code: `${ITERATOR} Object.prototype.then = function (r) { delete Object.prototype.then; r({ code: 0, diagnosed: false }) }; it.next = () => ({ done: true }); throw new Error('x')`,
    reads: { exitCode: 1, stderr: '' },
  },
  // Hangs its own run inside the runtime's drain (a keepalive map lookup), as
  // an infinite loop would: the deadline owns it.
  {
    label: 'Map.prototype.get poisoned',
    code: 'Map.prototype.get = function () { return undefined }; console.log(1)',
    reads: { exitCode: null, termination: 'timeout' },
  },
];

describe('post-guest paths: what the host owes whatever the guest replaced', () => {
  for (const { label, code } of [...FAITHFUL, ...BROKEN_RUNTIME]) {
    it(`${label} — resolves, bounded, no host text, no host failure`, async () => {
      const started = Date.now();
      const result = await runCode(code, { timeoutMs: TIMEOUT_MS }).catch((error: Error) => ({
        rejected: error.message,
      }));
      // Never an infrastructure failure of the host's, and never a hung call.
      expect(result).not.toHaveProperty('rejected');
      expect(Date.now() - started).toBeLessThan(SETTLE_BY_MS);
      expect(JSON.stringify(result)).not.toMatch(/child\.js|dist\/|file:/);
    }, 10_000);
  }

  for (const { label, code } of FAITHFUL) {
    it(`${label} — status is Node's and a failure is never silent`, async () => {
      const oracle = nodeEval(code);
      const result = await runCode(code, { timeoutMs: TIMEOUT_MS });
      expect({ label, exitCode: result.exitCode }).toEqual({ label, exitCode: oracle.code });
      if (oracle.code !== 0) {
        expect(result.stderr.length).toBeGreaterThan(0);
        // Where the guest hid nothing, its own error is what the consumer reads.
        if (KEEPS_ERROR_TEXT.has(label)) expect(result.stderr).toContain('Error: x');
      } else {
        expect(result.stdout).toBe(oracle.stdout);
      }
    }, 10_000);
  }

  for (const { label, code, reads, cleanForAFailure } of BROKEN_RUNTIME) {
    it(`${label} — reads exactly as declared`, async () => {
      const oracle = nodeEval(code);
      const result = await runCode(code, { timeoutMs: TIMEOUT_MS });
      const { stderr, ...status } = reads;
      expect({ label, exitCode: result.exitCode, termination: result.termination }).toEqual({
        label,
        ...status,
      });
      if (stderr !== undefined) expect({ label, stderr: result.stderr }).toEqual({ label, stderr });
      const clean = result.exitCode === 0 && result.stderr.length === 0;
      // Only the declared rows may read clean for a run Node failed.
      expect({ label, clean: clean && oracle.code !== 0 }).toEqual({
        label,
        clean: cleanForAFailure === true,
      });
    }, 10_000);
  }

  it('an unrenderable throw names its type, never a coercion through guest code', async () => {
    const result = await runCode('throw Object.create(null)');
    expect(result.stderr).toBe(
      'isolate-host: the run failed and no diagnostic could be rendered (object)\n',
    );
    expect(result.exitCode).toBe(1);
  });
});
