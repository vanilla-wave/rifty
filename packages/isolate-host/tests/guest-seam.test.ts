/**
 * The guest realm is the guest's, and rifty's runtime shares it: every lookup
 * made after guest code can be poisoned there (ADR-0557 §6). What the HOST owes
 * holds for every case in this file (Acceptance 16 → I3, I4):
 *
 *  - `runCode` resolves — a guest can never make the host report an
 *    infrastructure failure of its own;
 *  - the call settles within `timeoutMs` + 1000 ms — a guest can hang its own
 *    run (the host then kills it), never the consumer's call;
 *  - nothing reaches the host: the status crosses as one primitive and the
 *    child judges it in its own realm;
 *  - the host writes no stderr text of its own (beyond the two declared
 *    diagnostics, ADR-0557 §6).
 *
 * The guest bundle's tail runs in the guest realm too; it avoids every lookup
 * measured to steer it (the hooks below fire only inside its helpers). That is
 * measured, not proven exhaustive — the promises above do not rest on it.
 *
 * Node's exact status needs rifty's runtime intact. rifty's runtime does not
 * use primordials, so a guest that replaces intrinsics it uses can change its
 * own status and text in either direction, exit 0 for a Node failure included
 * — an open class (compat ⚠️, `backlog/runtime-js/post-guest-paths-use-
 * replaceable-intrinsics`). `BROKEN_RUNTIME` pins what each measured member
 * reads, so a change in any of them is seen; it is a sample, not the class.
 */
import { readFileSync } from 'node:fs';
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
  // The host tail chains with the captured `then`: a guest `then`/species
  // cannot skip the drain or resolve the run early.
  {
    label: 'Promise.prototype.then forged to resolve clean',
    code: "Promise.prototype.then = function (r) { r(0) }; throw new Error('x')",
  },
  {
    label: 'Number.isInteger poisoned',
    code: 'Number.isInteger = () => false; console.log(1)',
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
  {
    label: 'Object.prototype.then forged and the array iterator muted',
    code: `${ITERATOR} Object.prototype.then = function (r) { delete Object.prototype.then; r({ code: 0, diagnosed: false }) }; it.next = () => ({ done: true }); throw new Error('x')`,
  },
  // Hooks that fire only inside the host's own helpers (named in
  // HOST_FRAMES, checked against the bundle below): the host tail's species
  // read, its encoder and its timer table are not the guest's to steer.
  {
    label: 'Promise constructor getter exits 0 inside the host tail',
    code: "Object.defineProperty(Promise.prototype, 'constructor', { configurable: true, get() { if (new Error().stack.includes('onSettled')) process.exit(0); return Promise } }); setTimeout(() => { throw new Error('x') }, 50)",
  },
  {
    label: 'Promise species getter exits 0 inside the host tail',
    code: "Object.defineProperty(Promise, Symbol.species, { configurable: true, get() { if (new Error().stack.includes('onSettled')) process.exit(0); return Promise } }); setTimeout(() => { throw new Error('x') }, 50)",
  },
  {
    label: 'Promise constructor getter throws inside the host tail',
    code: "Object.defineProperty(Promise.prototype, 'constructor', { configurable: true, get() { if (new Error().stack.includes('onSettled')) throw new Error('boom'); return Promise } }); process.exitCode = 4",
  },
  {
    label: "TextEncoder.prototype.encode forges the host's write",
    code: "const o = TextEncoder.prototype.encode; TextEncoder.prototype.encode = function (s) { return new Error().stack.includes('writeHost') ? o.call(this, 'FORGED\\n') : o.call(this, s) }; throw new Error('x')",
  },
  {
    label: "Map.prototype.get hides the host's timers",
    code: "const g = Map.prototype.get; Map.prototype.get = function (k) { return new Error().stack.includes('fireTimer') ? undefined : g.call(this, k) }; setTimeout(() => { throw new Error('x') }, 5)",
  },
  {
    label: 'global Promise replaced before queueMicrotask',
    code: "globalThis.Promise = function () {}; globalThis.Promise.resolve = () => ({ then() {} }); queueMicrotask(() => console.log('mt'))",
  },
  { label: 'String replaced', code: "String = () => ''; throw new Error('x')" },
  {
    label: 'String replaced, throw from a timer',
    code: "String = () => ''; setTimeout(() => { throw new Error('x') }, 1)",
  },
  {
    label: 'Map.prototype.get poisoned',
    code: 'Map.prototype.get = function () { return undefined }; console.log(1)',
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
  'Promise.prototype.then forged to resolve clean',
  'array iterator ends early',
  'Array.prototype[Symbol.iterator] replaced',
  'Object.prototype.then forged and the array iterator muted',
  'Promise constructor getter exits 0 inside the host tail',
  'Promise species getter exits 0 inside the host tail',
  "TextEncoder.prototype.encode forges the host's write",
  "Map.prototype.get hides the host's timers",
  'String replaced',
  'String replaced, throw from a timer',
]);

/** Host helpers the hooks above match by name: a rename must fail here, not make them vacuous. */
const HOST_FRAMES = ['onSettled', 'writeHost', 'fireTimer'];

/**
 * Measured members of the open class: the guest replaced something rifty's
 * runtime uses to report its status, so the run answers differently from
 * Node's. `reads` is pinned exactly; `cleanForAFailure` marks a row where a run
 * Node failed reads as a clean success, so such a row is never added silently.
 */
const BROKEN_RUNTIME: readonly {
  readonly label: string;
  readonly code: string;
  readonly reads: Pick<RunCodeResult, 'exitCode'> & {
    readonly termination?: string;
    /** The guest broke its diagnostic path: nothing reached stderr, and the host adds nothing. */
    readonly stderr?: '';
    readonly stdout?: string;
  };
  readonly cleanForAFailure?: true;
}[] = [
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
  // The guest forged the runtime's own exit signal or terminal: the run reads
  // as the exit the guest chose.
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
  {
    label: 'exit signal lookalike thrown from a timer',
    code: "setTimeout(() => { throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 0 } })",
    reads: { exitCode: 0 },
    cleanForAFailure: true,
  },
  {
    label: 'exit signal lookalike thrown from a microtask',
    code: "queueMicrotask(() => { throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 0 } })",
    reads: { exitCode: 0 },
    cleanForAFailure: true,
  },
  // A species the runtime's own promise machinery cannot build: its run fails.
  {
    label: 'Promise species broken, exit from a timer',
    code: 'Promise.prototype.constructor = 0; Promise.prototype.then = (f) => f(); setTimeout(() => process.exit(2), 20)',
    reads: { exitCode: 1 },
  },
  // The guest's `then` skips the runtime's own error reporting: Node's status,
  // no text, and the host writes none of its own (goal.md Decisions).
  {
    label: 'Promise species broken, throw from a timer',
    code: "Promise.prototype.constructor = 0; Promise.prototype.then = (f) => f(); setTimeout(() => { throw new Error('x') })",
    reads: { exitCode: 1, stderr: '' },
  },
  {
    label: 'Promise species broken, pending rejection',
    code: "Promise.prototype.constructor = 0; Promise.prototype.then = (f) => f(); Promise.reject(new Error('x'))",
    reads: { exitCode: 1, stderr: '' },
  },
  // The runtime's terminal forged with a non-number status: not a primitive,
  // so it never crosses (resolving with an object would look up its `then`).
  {
    label: 'lifecycle slot forged with a thenable status',
    code: "const rg = Reflect.get; Reflect.get = (t, k, r) => (typeof k === 'symbol' && String(k).includes('lifecycle') ? { terminal: { exitCode: { then: (ok) => ok(0) } } } : rg(t, k, r)); throw new Error('x')",
    reads: { exitCode: 1 },
  },
  // The runtime's timer wrapper spreads the arguments through the iterator.
  {
    label: 'array iterator replaced before a timer with arguments fires',
    code: "setTimeout((a) => { process.stdout.write(String(a) + '\\n') }, 5, 'arg'); Array.prototype[Symbol.iterator] = function* () {}",
    reads: { exitCode: 0, stdout: 'undefined\n' },
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
      if (oracle.stderr.length > 0) {
        // Where Node reported something, so does the run.
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
      const { stderr, stdout, ...status } = reads;
      expect({ label, exitCode: result.exitCode, termination: result.termination }).toEqual({
        label,
        ...status,
      });
      if (stderr !== undefined) expect({ label, stderr: result.stderr }).toEqual({ label, stderr });
      if (stdout !== undefined) expect({ label, stdout: result.stdout }).toEqual({ label, stdout });
      const clean = result.exitCode === 0 && result.stderr.length === 0;
      // Only the declared rows may read clean for a run Node failed.
      expect({ label, clean: clean && oracle.code !== 0 }).toEqual({
        label,
        clean: cleanForAFailure === true,
      });
    }, 10_000);
  }

  it("a non-Error throw prints the runtime's fatal text, never a line of the host's", async () => {
    // rifty's `formatThrown`, as its fatal exit prints it; Node's `[eval]`
    // header and inspect form are a declared gap
    // (`backlog/runtime-js/node-eval-non-error-throw-rendering`).
    for (const [code, stderr] of [
      ["throw 'oops'", 'oops\n'],
      ['throw 5', '5\n'],
      ['throw Object.create(null)', '[object Object]\n'],
    ] as const) {
      const result = await runCode(code);
      expect({ code, stderr: result.stderr, exitCode: result.exitCode }).toEqual({
        code,
        stderr,
        exitCode: 1,
      });
    }
  });

  it('the host helpers the hooks match are named so in the built bundle', () => {
    const bundle = readFileSync(new URL('../dist/guest.js', import.meta.url), 'utf8');
    for (const name of HOST_FRAMES)
      expect({ name, defined: bundle.includes(`function ${name}(`) }).toEqual({
        name,
        defined: true,
      });
  });
});
