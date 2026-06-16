import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../packages/runtime-js/src/builtins/index.ts';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
import { NotImplementedError } from '../../../packages/io/src/errors.ts';
import { setVmEngineOverride } from '../../../packages/runtime-js/src/builtins/vm/engine-config.ts';
import { ensureVmEngineReady } from '../../../packages/runtime-js/src/builtins/vm/quickjs-loader.ts';
import {
  resetTelemetry,
  snapshotTelemetry,
} from '../../../packages/runtime-js/src/telemetry/divergence-sink.ts';

type VmScript = {
  runInThisContext(options?: VmRunOptions): unknown;
  runInContext(context: Record<string, unknown>, options?: VmRunOptions): unknown;
  runInNewContext(context?: Record<string, unknown>, options?: VmRunOptions): unknown;
};

type VmRunOptions = {
  cachedData?: Uint8Array;
  displayErrors?: boolean;
  timeout?: number;
  contextExtensions?: object[];
};

type VmContextOptions = {
  name?: string;
};

type VmModule = {
  Script: new (code: string, options?: VmRunOptions) => VmScript;
  compileFunction(
    code: string,
    params?: string[],
    options?: VmRunOptions,
  ): (...args: unknown[]) => unknown;
  createContext<T extends Record<string, unknown>>(sandbox?: T, options?: VmContextOptions): T;
  isContext(value: unknown): boolean;
  runInThisContext(code: string, options?: VmRunOptions): unknown;
  runInContext(code: string, context: Record<string, unknown>, options?: VmRunOptions): unknown;
  runInNewContext(code: string, context?: Record<string, unknown>, options?: VmRunOptions): unknown;
};

const vm = loadBuiltin('node:vm') as unknown as VmModule;

// Preload QuickJS once so the engine runs synchronously (it reads
// `getQuickJsModuleSync()`). Since the T17 cutover quickjs is the DEFAULT, so the
// `node:vm subset` block below exercises the real-realm engine; the rewrite opt-in
// blocks force `setVmEngineOverride('rewrite')`.
beforeAll(async () => {
  await ensureVmEngineReady();
});

describe('node:vm subset', () => {
  // This block runs on the DEFAULT engine (quickjs since the T17 cutover). A guest
  // throw crosses the membrane as a cross-realm MIRROR, so host `instanceof` is
  // FALSE (Node-correct: real Node's vm errors are cross-realm too — verified). We
  // therefore assert the error NAME, which is faithful on BOTH engines (the rewrite
  // opt-in runs in-realm so its `instanceof` would be true, but `.name` matches).
  const expectThrowsNamed = (fn: () => unknown, name: string): void => {
    let got = 'no-throw';
    try {
      fn();
    } catch (e) {
      got =
        e && (e as { constructor?: { name?: string } }).constructor
          ? ((e as { constructor: { name: string } }).constructor.name as string)
          : String(e);
    }
    expect(got).toBe(name);
  };

  it('runs scripts in this context', () => {
    (
      globalThis as typeof globalThis & { __riftyVmConformanceCount?: number }
    ).__riftyVmConformanceCount = undefined;

    expect(
      vm.runInThisContext(`
        globalThis.__riftyVmConformanceCount = (globalThis.__riftyVmConformanceCount || 0) + 4;
        globalThis.__riftyVmConformanceCount;
      `),
    ).toBe(4);

    const script = new vm.Script(`
      globalThis.__riftyVmConformanceCount += 6;
      globalThis.__riftyVmConformanceCount;
    `);
    expect(script.runInThisContext()).toBe(10);
  });

  it('runs scripts against explicit contexts', () => {
    const sandbox = { count: 1, nested: { label: 'kept' } as { label: string; extra?: number } };

    expect(
      vm.runInNewContext(
        `
          count += 2;
          nested.extra = count;
          count;
        `,
        sandbox,
      ),
    ).toBe(3);
    expect(sandbox).toEqual({ count: 3, nested: { label: 'kept', extra: 3 } });

    const context = vm.createContext({ value: 5 });
    expect(vm.isContext(context)).toBe(true);
    expect(new vm.Script('value *= 3; value;').runInContext(context)).toBe(15);
    expect(context).toMatchObject({ value: 15 });
  });

  it('uses the context object as the script global', () => {
    (globalThis as typeof globalThis & { __riftyVmCreated?: number }).__riftyVmCreated = undefined;
    (globalThis as typeof globalThis & { __riftyVmBlockLeak?: number }).__riftyVmBlockLeak =
      undefined;
    (globalThis as typeof globalThis & { __riftyVmLoopLeak?: number }).__riftyVmLoopLeak =
      undefined;
    const globals: Record<string, unknown> = {};

    expect(
      vm.runInNewContext(
        `
          __riftyVmCreated = 1;
          var declared = 2;
          if (true) __riftyVmBlockLeak = 5;
          for (let i = 0; i < 1; i++) __riftyVmLoopLeak = 6;
          this.viaThis = 3;
          globalThis.viaGlobal = 4;
          ({ __riftyVmCreated, declared, __riftyVmBlockLeak, __riftyVmLoopLeak, viaThis, viaGlobal });
        `,
        globals,
      ),
    ).toEqual({
      __riftyVmCreated: 1,
      declared: 2,
      __riftyVmBlockLeak: 5,
      __riftyVmLoopLeak: 6,
      viaThis: 3,
      viaGlobal: 4,
    });
    expect(globals).toMatchObject({
      __riftyVmCreated: 1,
      declared: 2,
      __riftyVmBlockLeak: 5,
      __riftyVmLoopLeak: 6,
      viaThis: 3,
      viaGlobal: 4,
    });
    expect(
      (globalThis as typeof globalThis & { __riftyVmCreated?: number }).__riftyVmCreated,
    ).toBeUndefined();
    expect(
      (globalThis as typeof globalThis & { __riftyVmBlockLeak?: number }).__riftyVmBlockLeak,
    ).toBeUndefined();
    expect(
      (globalThis as typeof globalThis & { __riftyVmLoopLeak?: number }).__riftyVmLoopLeak,
    ).toBeUndefined();
  });

  it('keeps context writes independent of shadowed globalThis parameters', () => {
    const globals: Record<string, unknown> = {};

    expect(
      vm.runInNewContext(
        `
          function write(globalThis) {
            shadowedWrite = 7;
            return globalThis.shadowedWrite;
          }
          ({ returned: write({}), sandboxValue: shadowedWrite });
        `,
        globals,
      ),
    ).toEqual({ returned: undefined, sandboxValue: 7 });
    expect(globals.shadowedWrite).toBe(7);
  });

  it('hoists top-level var declarations onto the context before initializers run', () => {
    const globals: Record<string, unknown> = {};

    expect(
      vm.runInNewContext(
        `
          before = typeof x + ':' + String(x);
          var x = 1;
          var y = y === undefined ? 2 : 9;
          ({ before, x, y });
        `,
        globals,
      ),
    ).toEqual({ before: 'undefined:undefined', x: 1, y: 2 });
    expect(globals).toMatchObject({ before: 'undefined:undefined', x: 1, y: 2 });
  });

  it('keeps writes from top-level var initializers sandboxed', () => {
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    (globalThis as HostGlobals).__riftyVmInitLeak = undefined;
    (globalThis as HostGlobals).__riftyVmInitLeak2 = undefined;
    const globals: Record<string, unknown> = {};

    expect(
      vm.runInNewContext(
        `
          var a = function () { __riftyVmInitLeak = 1; };
          a();
          var b = (function () { __riftyVmInitLeak2 = 2; return 3; })();
          ({ leak: __riftyVmInitLeak, leak2: __riftyVmInitLeak2, b });
        `,
        globals,
      ),
    ).toEqual({ leak: 1, leak2: 2, b: 3 });
    expect(globals).toMatchObject({ __riftyVmInitLeak: 1, __riftyVmInitLeak2: 2, b: 3 });
    expect((globalThis as HostGlobals).__riftyVmInitLeak).toBeUndefined();
    expect((globalThis as HostGlobals).__riftyVmInitLeak2).toBeUndefined();
  });

  it('sandboxes compound assignment and update operators', () => {
    // The operands are SANDBOX globals (a fresh vm realm does NOT inherit host
    // globals — verified against real Node). A same-named host global is a separate
    // realm and stays untouched. An undeclared compound/update target throws a
    // cross-realm ReferenceError (asserted by name).
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    (globalThis as HostGlobals).__riftyVmCompoundHost = 10;
    (globalThis as HostGlobals).__riftyVmUpdHost = 1;
    try {
      const globals: Record<string, unknown> = { compoundCtx: 10, updCtx: 1 };

      expect(
        vm.runInNewContext(
          `
            compoundCtx += 5;
            const post = updCtx++;
            ({ post, compound: compoundCtx, upd: updCtx });
          `,
          globals,
        ),
      ).toEqual({ post: 1, compound: 15, upd: 2 });
      expect(globals).toMatchObject({ compoundCtx: 15, updCtx: 2 });
      // a same-named HOST global is a different realm — never mutated by the sandbox
      expect((globalThis as HostGlobals).__riftyVmCompoundHost).toBe(10);
      expect((globalThis as HostGlobals).__riftyVmUpdHost).toBe(1);
      expectThrowsNamed(
        () => vm.runInNewContext('__riftyVmMissingCompound += 1;', {}),
        'ReferenceError',
      );
      expectThrowsNamed(
        () => vm.runInNewContext('__riftyVmMissingUpdate++;', {}),
        'ReferenceError',
      );
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyVmCompoundHost');
      Reflect.deleteProperty(globalThis, '__riftyVmUpdHost');
    }
  });

  it('keeps logical assignment short-circuit semantics sandboxed', () => {
    // Operands are SANDBOX globals (no host inheritance). `??=` on an undefined
    // sandbox global assigns; `&&=` on a falsy one short-circuits (no write). An
    // undeclared `&&=` target throws a cross-realm ReferenceError (by name).
    const globals: Record<string, unknown> = { nullishCtx: undefined, andCtx: 0 };

    expect(
      vm.runInNewContext(
        `
          nullishCtx ??= 'set';
          andCtx &&= 'no';
          ({ nullish: nullishCtx, and: andCtx });
        `,
        globals,
      ),
    ).toEqual({ nullish: 'set', and: 0 });
    expect(globals).toMatchObject({ nullishCtx: 'set', andCtx: 0 });
    expectThrowsNamed(
      () => vm.runInNewContext('__riftyVmMissingLogical &&= 1;', {}),
      'ReferenceError',
    );
  });

  it('sandboxes destructuring assignment targets', () => {
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    const names = ['dA', 'dB', 'dC', 'dR', 'sh'];
    try {
      const globals: Record<string, unknown> = {};

      expect(
        vm.runInNewContext(
          `
            ({ a: dA, b: dB = 8 } = { a: 4 });
            [dC, ...dR] = [1, 2, 3];
            ({ sh = 5 } = {});
            ({ dA, dB, dC, dR, sh });
          `,
          globals,
        ),
      ).toEqual({ dA: 4, dB: 8, dC: 1, dR: [2, 3], sh: 5 });
      expect(globals).toMatchObject({ dA: 4, dB: 8, dC: 1, dR: [2, 3], sh: 5 });
      for (const name of names) expect(name in globalThis).toBe(false);
    } finally {
      for (const name of names) Reflect.deleteProperty(globalThis, name);
    }
  });

  it('keeps switch case lexical bindings out of the context', () => {
    const globals: Record<string, unknown> = {};

    expect(
      vm.runInNewContext(
        `
          switch (1) { case 1: let local = 1; local = 2; caseLocal = local; }
          caseLocal;
        `,
        globals,
      ),
    ).toBe(2);
    expect(globals).toMatchObject({ caseLocal: 2 });
    expect('local' in globals).toBe(false);
  });

  it('keeps for-in and for-of targets on the context', () => {
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    try {
      const globals: Record<string, unknown> = {};

      expect(
        vm.runInNewContext(
          `
            for (var k in { a: 1, b: 1 }) ;
            for (__riftyVmLoose of [14]) ;
            ({ k, loose: __riftyVmLoose });
          `,
          globals,
        ),
      ).toEqual({ k: 'b', loose: 14 });
      expect(globals).toMatchObject({ k: 'b', __riftyVmLoose: 14 });
      expect('__riftyVmLoose' in globalThis).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyVmLoose');
    }
  });

  it('deletes unbound names from the context, not the host', () => {
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    (globalThis as HostGlobals).__riftyVmDeleteHost = 'host';
    try {
      const globals: Record<string, unknown> = { gone: 1 };

      expect(
        vm.runInNewContext(
          `
            const removedCtx = delete gone;
            const removedHost = delete __riftyVmDeleteHost;
            ({ removedCtx, removedHost });
          `,
          globals,
        ),
      ).toEqual({ removedCtx: true, removedHost: true });
      expect('gone' in globals).toBe(false);
      expect((globalThis as HostGlobals).__riftyVmDeleteHost).toBe('host');
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyVmDeleteHost');
    }
  });

  it('keeps missing reads loud and function declarations on the context', () => {
    const functions: Record<string, unknown> = {};

    expect(vm.runInNewContext('function f() { return 9; } f();', functions)).toBe(9);
    expect(functions.f).toBeTypeOf('function');
    // cross-realm: the guest ReferenceError is a mirror (host instanceof FALSE,
    // matching real Node), so assert the NAME.
    expectThrowsNamed(() => vm.runInNewContext('missing', {}), 'ReferenceError');
  });

  it('hoists top-level function declarations so they are callable before their text', () => {
    const ctx: Record<string, unknown> = {};
    expect(vm.runInNewContext('var r = f(); function f() { return 9; } r;', ctx)).toBe(9);
    expect(ctx.f).toBeTypeOf('function');

    expect(
      vm.runInNewContext(
        'function a(n) { return n <= 0 ? 0 : b(n - 1); } function b(n) { return a(n) + 1; } a(3);',
        {},
      ),
    ).toBe(3);

    const reassigned: Record<string, unknown> = {};
    expect(vm.runInNewContext('function f() { return 1; } f = 5; f;', reassigned)).toBe(5);
    expect(reassigned.f).toBe(5);
  });

  it('gives declaration statements an empty completion value like Node', () => {
    expect(vm.runInNewContext('var q = 5;', {})).toBeUndefined();
    expect(vm.runInNewContext('1; var w = 7;', {})).toBe(1);
    expect(vm.runInNewContext('9; var z;', {})).toBe(9);
    expect(vm.runInNewContext('var a = 1, b = 2;', {})).toBeUndefined();
    expect(vm.runInNewContext('function f() {}', {})).toBeUndefined();
    expect(vm.runInNewContext('5; function f() {}', {})).toBe(5);
    expect(vm.runInNewContext('var x = 5; x;', {})).toBe(5);
  });

  it('runs a top-level var as the unbraced body of if/else/do-while (completion wrapper consumes the source ;)', () => {
    // Regression (PR #30): the `{ let T = (…); }` completion-neutraliser left the
    // source `;` dangling, ending the if-consequent / loop body early.
    expect(vm.runInNewContext('if (false) var x = 1; else 2;', {})).toBe(2);
    expect(vm.runInNewContext('if (false) var a = 1; else var b = 2; b', {})).toBe(2);
    expect(vm.runInNewContext('if (false) var x = 1; else if (true) 2;', {})).toBe(2);
    expect(vm.runInNewContext('if (true) { if (false) var x = 1; else 2; }', {})).toBe(2);
    expect(vm.runInNewContext('do var x = 1; while (false); x', {})).toBe(1);
    expect(vm.runInNewContext('var i = 0; do var x; while (i++ < 2); i', {})).toBe(3);
    expect(
      vm.runInNewContext('if (false) var { a } = { a: 1 }; else var { b } = { b: 2 }; b', {}),
    ).toBe(2);
    // braced bodies + statement-list position unchanged
    expect(vm.runInNewContext('if (false) { var x = 1; } else 2;', {})).toBe(2);
    expect(vm.runInNewContext('var a = 1, b = 2; a + b', {})).toBe(3);
  });

  it('leaves a writable intrinsic intact for a declaration-only var of the same name', () => {
    // Regression (PR #30): a no-init `var Map;` registered the name and shadowed the
    // real Map to undefined; Node leaves the writable intrinsic until it is assigned.
    expect(vm.runInNewContext('var Map; var m = new Map(); m.set("k", 1); m.get("k")', {})).toBe(1);
    expect(vm.runInNewContext('var JSON; JSON.stringify({ a: 1 })', {})).toBe('{"a":1}');
    expect(vm.runInNewContext('var Array; typeof Array', {})).toBe('function');
    // assigning the name still shadows the intrinsic (own property wins)
    expect(vm.runInNewContext('var Map; Map = 7; Map', {})).toBe(7);
    expect(vm.runInNewContext('var Map; Map = undefined; typeof Map', {})).toBe('undefined');
    // cross-realm: the guest TypeError is a mirror (host instanceof FALSE) — assert NAME.
    expectThrowsNamed(
      () => vm.runInNewContext('var Map; Map = undefined; new Map()', {}),
      'TypeError',
    );
    // a non-intrinsic no-init var still reads undefined
    expect(vm.runInNewContext('var foo; typeof foo', {})).toBe('undefined');
  });

  it('lands statement-position var destructuring patterns on the context', () => {
    const ctx: Record<string, unknown> = {};
    expect(
      vm.runInNewContext(
        'var { a, b = 2, ...rest } = { a: 1, c: 3, d: 4 }; var [x, , y = 9] = [10]; ({ a, b, rest, x, y });',
        ctx,
      ),
    ).toEqual({ a: 1, b: 2, rest: { c: 3, d: 4 }, x: 10, y: 9 });
    expect(Object.keys(ctx).sort()).toEqual(['a', 'b', 'rest', 'x', 'y']);

    const nested: Record<string, unknown> = {};
    expect(vm.runInNewContext('var { p: { q } } = { p: { q: 5 } }; ({ q });', nested)).toEqual({
      q: 5,
    });
    expect('q' in nested).toBe(true);
    expect('p' in nested).toBe(false);
  });

  it('rewrites a parenthesised last var initializer without corrupting the source', () => {
    // acorn strips wrapping parens from the init node, so the completion-neutral
    // `{ let T = (…); }` closer must use the declarator's end, not init.end.
    expect(vm.runInNewContext('var c = (1, 2, 3); c', {})).toBe(3);
    expect(vm.runInNewContext('var x = (5); x', {})).toBe(5);
    expect(vm.runInNewContext('var x = ((7)); x', {})).toBe(7);
    expect(vm.runInNewContext('var z = (9)', {})).toBeUndefined();
    expect(vm.runInNewContext('var f = (a => a + 1); f(4)', {})).toBe(5);
    expect(vm.runInNewContext('var o = ({ a: 1 }); o.a', {})).toBe(1);
    expect(vm.runInNewContext('var a = 1, b = (2); a + b', {})).toBe(3);

    const ctx: Record<string, unknown> = {};
    expect(vm.runInNewContext('var { a } = ({ a: 1 }); var [b] = ([2]); ({ a, b });', ctx)).toEqual(
      {
        a: 1,
        b: 2,
      },
    );
    expect(Object.keys(ctx).sort()).toEqual(['a', 'b']);
  });

  it('keeps context var bindings readable after the run instead of leaking to the host', () => {
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    const ctx: Record<string, unknown> = {};
    vm.runInNewContext('var unset; this.read = function () { return unset; };', ctx);
    expect((ctx.read as () => unknown)()).toBeUndefined();

    (globalThis as HostGlobals).__riftyVmGapShadow = 'HOST';
    try {
      const shadowed: Record<string, unknown> = {};
      vm.runInNewContext(
        'var __riftyVmGapShadow; this.read = function () { return __riftyVmGapShadow; };',
        shadowed,
      );
      expect((shadowed.read as () => unknown)()).toBeUndefined();
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyVmGapShadow');
    }

    const persistent = vm.createContext({});
    vm.runInContext('var later;', persistent);
    expect(vm.runInContext('typeof later;', persistent)).toBe('undefined');
  });

  it('gives a seeded host array/object its prototype methods in the guest (T19)', () => {
    // Regression (T19): the inbound membrane severed a host array/object seed's
    // proto to null, which kept `instanceof Array/Object` FALSE but STRIPPED every
    // inherited method (`items.join`/`.map`, `obj.hasOwnProperty` threw "not a
    // function"). Node gives the seed a cross-realm proto that CARRIES the methods.
    const ctx = vm.createContext({ items: ['x', 'y', 'z'], obj: { a: 1 } });
    expect(vm.runInContext('items.join("-")', ctx)).toBe('x-y-z');
    expect(
      vm.runInContext('items.map(function (i) { return i.toUpperCase(); }).join(",")', ctx),
    ).toBe('X,Y,Z');
    expect(vm.runInContext('typeof items.join', ctx)).toBe('function');
    expect(vm.runInContext('Array.isArray(items)', ctx)).toBe(true);
    expect(vm.runInContext('items instanceof Array', ctx)).toBe(false);
    expect(vm.runInContext('items.hasOwnProperty(0)', ctx)).toBe(true);
    expect(vm.runInContext('obj.hasOwnProperty("a")', ctx)).toBe(true);
    expect(vm.runInContext('obj instanceof Object', ctx)).toBe(false);
    expect(vm.runInContext('Object.prototype.toString.call(obj)', ctx)).toBe('[object Object]');
  });

  it('renders a non-object context arg with Node-exact ERR_INVALID_ARG_TYPE text (T19)', () => {
    // describeNonObject fidelity: undefined/null render BARE; a bigint keeps its
    // `n`; `-0` stays `-0`; a string is quote-selected + truncated >28 to 25+'...'.
    const msg = (a: unknown): string => {
      try {
        vm.runInContext('1', a as Record<string, unknown>);
        return 'NO THROW';
      } catch (e) {
        return (e as Error).message;
      }
    };
    const tail = 'The "object" argument must be of type object. Received ';
    expect(msg(undefined)).toBe(`${tail}undefined`);
    expect(msg(null)).toBe(`${tail}null`);
    expect(msg(42)).toBe(`${tail}type number (42)`);
    expect(msg(-0)).toBe(`${tail}type number (-0)`);
    expect(msg(0n)).toBe(`${tail}type bigint (0n)`);
    expect(msg(-5n)).toBe(`${tail}type bigint (-5n)`);
    expect(msg('hi')).toBe(`${tail}type string ('hi')`);
    expect(msg("it's")).toBe(`${tail}type string ("it's")`);
    expect(msg(true)).toBe(`${tail}type boolean (true)`);
    expect(msg(Symbol('s'))).toBe(`${tail}type symbol (Symbol(s))`);
    expect(msg('x'.repeat(40))).toBe(`${tail}type string ('${'x'.repeat(25)}...')`);
  });

  it('compiles functions with parameters', () => {
    const add = vm.compileFunction('return a + b;', ['a', 'b']);
    expect(add(2, 5)).toBe(7);
  });

  it('throws loudly for unsupported execution controls', () => {
    expect(() => vm.runInThisContext('1 + 1', { timeout: 1 })).toThrow(NotImplementedError);
    expect(() => vm.runInThisContext('1 + 1', { cachedData: new Uint8Array() })).toThrow(
      NotImplementedError,
    );
    expect(() => vm.runInThisContext('1 + 1', { displayErrors: false })).toThrow(
      NotImplementedError,
    );
    expect(() => vm.createContext({}, { name: 'sandbox' })).toThrow(NotImplementedError);
    expect(() => vm.compileFunction('return 1;', [], { contextExtensions: [{}] })).toThrow(
      NotImplementedError,
    );
  });

  it('rejects null contexts', () => {
    expect(() => vm.createContext(null as unknown as Record<string, unknown>)).toThrow(TypeError);
    expect(() => vm.runInNewContext('1 + 1', null as unknown as Record<string, unknown>)).toThrow(
      TypeError,
    );
  });

  it('rejects a non-contextified object passed to runInContext (engine-agnostic)', () => {
    // Regression (T17 cutover GATE): the quickjs engine accepted a plain `{}`
    // silently; Node throws a TypeError ("must be an vm.Context"). The guard now
    // lives at the dispatcher so BOTH engines (default + opt-in) reject it.
    expect(() => vm.runInContext('1 + 1', {})).toThrow(TypeError);
    expect(() => vm.runInContext('1 + 1', {})).toThrow(/must be an vm\.Context/);
    expect(() => new vm.Script('1 + 1').runInContext({})).toThrow(TypeError);
    // a real contextified object is accepted
    expect(vm.runInContext('1 + 1', vm.createContext({}))).toBe(2);
  });
});

// T13 — real global-object fidelity (QuickJS realm). The rewrite engine (with(proxy)
// over a plain property bag) could not reproduce a real vm global object's
// attribute/lexical/strict semantics; the QuickJS real realm does — mostly BY
// CONSTRUCTION (real intrinsics, strict mode, lexical scope, real global). Behaviour
// is verified byte-for-byte against real Node in the parity case
// `vm/quickjs-global-object`; this suite locks the same behaviour in-unit and also
// records the ONE genuine QuickJS-vs-V8 divergence (function-named-intrinsic
// redeclaration error type) so a regression in either direction is loud (T19).
describe('node:vm QuickJS global-object fidelity (T13)', () => {
  // Guest errors cross the membrane as cross-realm MIRRORS: `instanceof`/
  // `constructor ===` against host constructors are FALSE (different realm), but
  // `.constructor.name`/`.name` are faithful (T11). So we assert on the name.
  const ctor = (e: unknown): string =>
    e && (e as { constructor?: { name?: string } }).constructor
      ? ((e as { constructor: { name: string } }).constructor.name as string)
      : String(e);
  const throwsNamed = (fn: () => unknown, name: string): void => {
    let got = 'no-throw';
    try {
      fn();
    } catch (e) {
      got = ctor(e);
    }
    expect(got).toBe(name);
  };

  beforeAll(() => setVmEngineOverride('quickjs'));
  afterAll(() => setVmEngineOverride(undefined));

  it('treats redeclared intrinsics as non-writable data props (silent no-op)', () => {
    const sb = vm.createContext({});
    expect(vm.runInContext('var undefined = 5; undefined', sb)).toBeUndefined();
    expect(vm.runInContext('var NaN = 1; NaN', sb)).toBeNaN();
    expect(vm.runInContext('var Infinity = 0; Infinity', sb)).toBe(Number.POSITIVE_INFINITY);
    expect(vm.runInContext('NaN = 1; NaN', sb)).toBeNaN();
    // the silent intrinsic redeclaration never surfaces on the sandbox object
    expect(Object.keys(sb)).toEqual([]);
  });

  it('makes var/function bindings non-configurable (delete is a no-op returning false)', () => {
    const sb = vm.createContext({});
    expect(vm.runInContext('var d = 5; delete d; d', sb)).toBe(5);
    expect(vm.runInContext('function f(){}; delete f', sb)).toBe(false);
    expect(vm.runInContext('typeof f', sb)).toBe('function');
  });

  it('pre-declares the lexical intrinsics so let-redeclaration is a SyntaxError', () => {
    const sb = vm.createContext({});
    throwsNamed(() => vm.runInContext('let undefined = 5', sb), 'SyntaxError');
  });

  it('reads back a written globalThis and a context var named eval', () => {
    const sb = vm.createContext({});
    expect(vm.runInContext('var globalThis = 5; globalThis', sb)).toBe(5);
    const sb2 = vm.createContext({});
    expect(vm.runInContext('var eval = 5; eval', sb2)).toBe(5);
  });

  it('throws ReferenceError for a strict-mode undeclared write', () => {
    const sb = vm.createContext({});
    throwsNamed(() => vm.runInContext('"use strict"; xxx = 1', sb), 'ReferenceError');
  });

  it('exposes a declaration-only var on the vm global but NOT on the sandbox object', () => {
    const sb = vm.createContext({});
    vm.runInContext('var z;', sb);
    // sandbox object: no own key (V8 contextify copies a global to the sandbox only
    // when an assignment fired; a pure `var z;` declaration never sets)
    expect(Object.keys(sb)).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(sb, 'z')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(sb, 'z')).toBeUndefined();
    // vm GLOBAL (`this`): a non-configurable, enumerable own prop, value undefined
    expect(vm.runInContext('JSON.stringify(Object.getOwnPropertyDescriptor(this,"z"))', sb)).toBe(
      '{"writable":true,"enumerable":true,"configurable":false}',
    );
    expect(vm.runInContext('JSON.stringify(Object.keys(this))', sb)).toBe('["z"]');
    expect(vm.runInContext('this.hasOwnProperty("z")', sb)).toBe(true);
    expect(vm.runInContext('[String(this.z), "z" in this].join(",")', sb)).toBe('undefined,true');
    // a later actual assignment surfaces on the sandbox
    vm.runInContext('z = 42;', sb);
    expect(sb.z).toBe(42);
    expect(Object.keys(sb)).toEqual(['z']);
  });

  it('propagates assigned vars/functions/this-props/bare-assignments to the sandbox', () => {
    const sb = vm.createContext({});
    vm.runInContext('var assigned = 5; var declonly; this.tp = 9; bare = 7; function fn(){}', sb);
    expect(Object.keys(sb).sort()).toEqual(['assigned', 'bare', 'fn', 'tp']);
    expect(Object.prototype.hasOwnProperty.call(sb, 'declonly')).toBe(false);
    // configurable undefined writes DO propagate (only declaration-only vars skip)
    const sb2 = vm.createContext({});
    vm.runInContext('this.tp = undefined; bare = undefined;', sb2);
    expect(Object.keys(sb2).sort()).toEqual(['bare', 'tp']);
    // an existing sandbox key is never wiped by a same-name declaration-only var
    const sb3 = vm.createContext({ pre: 99 });
    vm.runInContext('var pre;', sb3);
    expect(sb3.pre).toBe(99);
  });

  it('persists top-level let/const/class across runs as the context lexical scope', () => {
    const sb = vm.createContext({});
    vm.runInContext('let persist = 7', sb);
    expect(vm.runInContext('persist', sb)).toBe(7);
    throwsNamed(() => vm.runInContext('let persist = 8', sb), 'SyntaxError');
    vm.runInContext('const k = 11', sb);
    expect(vm.runInContext('k', sb)).toBe(11);
    throwsNamed(() => vm.runInContext('const k = 12', sb), 'SyntaxError');
    vm.runInContext('class Cls { m(){ return 42; } }', sb);
    expect(vm.runInContext('new Cls().m()', sb)).toBe(42);
    throwsNamed(() => vm.runInContext('class Cls {}', sb), 'SyntaxError');
    // lexical bindings stay OFF the sandbox object (they are not global props)
    expect(Object.keys(sb)).toEqual([]);
    expect(sb.persist).toBeUndefined();
  });

  it('documents the sandbox key ENUMERATION-order divergence (T19)', () => {
    // V8 contextify copies a global back to the sandbox via the named-property
    // SETTER, so the sandbox key order is: hoisted FUNCTIONS first, then everything
    // else in SOURCE/EXECUTION order (vars + bare assignments interleaved). The
    // QuickJS real realm has no such interceptor — the post-run sweep walks the
    // guest global's own-enumerable keys in QuickJS creation order: GLOBAL-INSTANTIATED
    // var bindings first (decl order), then hoisted functions, then bare assignments.
    // We faithfully surface the engine's real enumeration rather than reconstruct
    // V8's setter order (would need source-position parsing the real-realm engine
    // avoids), so this is a genuine ES2023-vs-V8 residual (T19). `Object.keys` order
    // of a contextified sandbox is V8-internal, not a spec guarantee. The rewrite
    // opt-in is V8-correct here (parity case `rewrite-optin-run-in-new-context`).
    const sb = vm.createContext({});
    vm.runInContext('a=1; var b=2; c=3; var d=4; function e(){}', sb);
    // QuickJS order: vars (b,d) → function (e) → bare assignments (a,c).
    // (V8 would be: e, a, b, c, d.)
    expect(Object.keys(sb)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  it('documents the function-named-intrinsic redeclaration divergence (T19)', () => {
    // V8 raises an EARLY SyntaxError ("Identifier 'undefined' has already been
    // declared"); QuickJS raises the spec-literal RUNTIME TypeError ("cannot define
    // variable 'undefined'") from GlobalDeclarationInstantiation /
    // CanDeclareGlobalFunction. We faithfully surface the engine's real error rather
    // than fake V8's type, so this is the one genuine ES2023-vs-V8 residual (T19);
    // `let undefined` (lexical) DOES match V8 above. This test pins QuickJS's actual
    // type so a change is caught.
    const sb = vm.createContext({});
    throwsNamed(() => vm.runInContext('function undefined(){}', sb), 'TypeError');
  });
});

// T15 — rewrite-engine opt-in is LOUD. A sandbox run under the opt-in `rewrite`
// engine must emit ONE stderr warning per process AND record a divergence hit, so
// the gap is never silent. The warning goes to `process.stderr.write` (real fd 2
// in plain Node, the worker stderr bridge in the worker) — NOT `console.error` —
// so it never pollutes parity STDOUT (the parity runner diffs stdout and only
// intercepts console.*). resetTelemetry() in beforeEach re-arms the warnOnce gate.
describe('node:vm rewrite-engine loud opt-in + telemetry wiring (T15)', () => {
  const WARNING =
    '[rifty] node:vm is using the hardened-rewrite engine (opt-in). Known divergences ' +
    'vs the default QuickJS real realm: cross-realm identity (instanceof across ' +
    'contexts), direct eval leaks to host, no real global-object semantics. See docs.\n';

  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetTelemetry();
    setVmEngineOverride('rewrite');
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stderrSpy.mockRestore();
    setVmEngineOverride(undefined);
    resetTelemetry();
  });

  const warnCalls = (): string[] =>
    stderrSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('[rifty] node:vm'));

  it('emits the loud warning exactly once and records a divergence hit', () => {
    expect(vm.runInNewContext('1 + 1', {})).toBe(2);
    // repeated runs (incl. Script + runInContext paths) must NOT re-warn
    expect(vm.runInNewContext('2 + 2', {})).toBe(4);
    const ctx = vm.createContext({ x: 1 });
    expect(vm.runInContext('x + 1', ctx)).toBe(2);
    expect(new vm.Script('3 + 3').runInContext(vm.createContext({}))).toBe(6);

    const calls = warnCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(WARNING);

    const snap = snapshotTelemetry();
    const entry = snap.find((e) => e.feature === 'vm.engine.rewrite-active');
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('divergence');
    // every sandbox RUN counts (4 runs above), but the warning only fires once
    expect(entry?.count).toBe(4);
  });

  it('does NOT warn when the quickjs engine is selected', () => {
    setVmEngineOverride('quickjs');
    expect(vm.runInNewContext('1 + 1', {})).toBe(2);
    expect(warnCalls()).toHaveLength(0);
    expect(snapshotTelemetry().some((e) => e.feature === 'vm.engine.rewrite-active')).toBe(false);
  });

  it('does NOT warn for createContext alone (contextify is not a run)', () => {
    vm.createContext({ a: 1 });
    expect(warnCalls()).toHaveLength(0);
    expect(snapshotTelemetry()).toEqual([]);
  });
});
