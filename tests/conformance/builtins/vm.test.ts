import { describe, expect, it } from 'vitest';
import '../../../packages/runtime-js/src/builtins/index.ts';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
import { NotImplementedError } from '../../../packages/io/src/errors.ts';

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

describe('node:vm subset', () => {
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
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    (globalThis as HostGlobals).__riftyVmCompoundHost = 10;
    (globalThis as HostGlobals).__riftyVmUpdHost = 1;
    try {
      const globals: Record<string, unknown> = {};

      expect(
        vm.runInNewContext(
          `
            __riftyVmCompoundHost += 5;
            const post = __riftyVmUpdHost++;
            ({ post, compound: __riftyVmCompoundHost, upd: __riftyVmUpdHost });
          `,
          globals,
        ),
      ).toEqual({ post: 1, compound: 15, upd: 2 });
      expect(globals).toMatchObject({ __riftyVmCompoundHost: 15, __riftyVmUpdHost: 2 });
      expect((globalThis as HostGlobals).__riftyVmCompoundHost).toBe(10);
      expect((globalThis as HostGlobals).__riftyVmUpdHost).toBe(1);
      expect(() => vm.runInNewContext('__riftyVmMissingCompound += 1;', {})).toThrow(
        ReferenceError,
      );
      expect(() => vm.runInNewContext('__riftyVmMissingUpdate++;', {})).toThrow(ReferenceError);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyVmCompoundHost');
      Reflect.deleteProperty(globalThis, '__riftyVmUpdHost');
    }
  });

  it('keeps logical assignment short-circuit semantics sandboxed', () => {
    type HostGlobals = typeof globalThis & Record<string, unknown>;
    (globalThis as HostGlobals).__riftyVmNullishHost = undefined;
    (globalThis as HostGlobals).__riftyVmAndHost = 0;
    try {
      const globals: Record<string, unknown> = {};

      expect(
        vm.runInNewContext(
          `
            __riftyVmNullishHost ??= 'set';
            __riftyVmAndHost &&= 'no';
            ({ nullish: __riftyVmNullishHost, and: __riftyVmAndHost });
          `,
          globals,
        ),
      ).toEqual({ nullish: 'set', and: 0 });
      expect(globals).toMatchObject({ __riftyVmNullishHost: 'set' });
      expect('__riftyVmAndHost' in globals).toBe(false);
      expect((globalThis as HostGlobals).__riftyVmNullishHost).toBeUndefined();
      expect((globalThis as HostGlobals).__riftyVmAndHost).toBe(0);
      expect(() => vm.runInNewContext('__riftyVmMissingLogical &&= 1;', {})).toThrow(
        ReferenceError,
      );
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyVmNullishHost');
      Reflect.deleteProperty(globalThis, '__riftyVmAndHost');
    }
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
    expect(() => vm.runInNewContext('missing', {})).toThrow(ReferenceError);
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
    expect(() => vm.runInNewContext('var Map; Map = undefined; new Map()', {})).toThrow(TypeError);
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
});
