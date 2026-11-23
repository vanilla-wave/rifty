import { compileFunction } from 'node:vm';
import { expect, it } from 'vitest';
import { compileCjsFactory } from './cjs-factory.ts';

it('strict factory retains native function-body bindings and return semantics', () => {
  const source = `"use strict";
let callee;
try { arguments.callee; } catch (error) { callee = error.name; }
return { ownThis: this === exports, arguments: arguments.length,
  newTarget: typeof new.target, anonymous: typeof anonymous,
  directEval: eval('typeof exports'), callee };
`;
  const parameters = ['exports', 'require', 'module', '__filename', '__dirname'];
  const exports = {};
  const args = [exports, () => undefined, { exports }, '/app/main.cjs', '/app'];
  const native = compileFunction(source, parameters).apply(exports, args);
  expect(compileCjsFactory([], source, '/app/main.cjs')().apply(exports, args)).toEqual(native);
});

it('a multiline filename cannot escape the sourceURL and run while compiling', () => {
  let calls = 0;
  Object.defineProperty(globalThis, '__riftyFilenameHook', {
    configurable: true,
    value: () => {
      calls += 1;
    },
  });
  try {
    const source = '"use strict";\nreturn 42;';
    const filename = '/app/entry\n;globalThis.__riftyFilenameHook(); //';
    const native = compileFunction(source, [], { filename });
    const actual = compileCjsFactory([], source, filename)();
    expect(calls).toBe(0);
    expect(typeof actual).toBe(typeof native);
  } finally {
    Reflect.deleteProperty(globalThis, '__riftyFilenameHook');
  }
});

it.each([
  [
    'a stray closing brace',
    'globalThis.__riftyRan = 1;\n}}\nglobalThis.__riftyRan = 2;\nfunction b() {\n',
  ],
  ['a brace closed later', 'globalThis.__riftyRan = 1;\n}\nglobalThis.__riftyRan = 2;\n{\n'],
  [
    'a wrapper escape',
    'globalThis.__riftyRan = 1;\n}); globalThis.__riftyRan = 2; (function () {\n',
  ],
])('%s: compileFunction refuses it and no line of it runs', (_, source) => {
  const parameters = ['exports', 'require', 'module', '__filename', '__dirname'];
  expect(() => compileFunction(source, parameters)).toThrow(SyntaxError);
  Reflect.deleteProperty(globalThis, '__riftyRan');
  expect(() => compileCjsFactory([], source, '/app/broken.cjs')()).toThrow(SyntaxError);
  expect(Reflect.get(globalThis, '__riftyRan')).toBeUndefined();
});

it.each([
  ['--> legacy\nreturn 1;'],
  ['   --> legacy\nreturn 1;'],
  ['/* a */ --> legacy\nreturn 1;'],
  ['﻿--> legacy\nreturn 1;'],
  ['/* a\n */ --> legacy\nreturn 1;'],
  ['<!-- legacy\nreturn 1 <!-- tail\n;'],
  ['x = 1 --> 0;\nreturn x;'],
  [' #!/usr/bin/env node\nreturn 1;'],
  ['"--> no"; return 1;'],
])('first-line form %j: accepted and run as compileFunction does', (source) => {
  const parameters = ['exports', 'require', 'module', '__filename', '__dirname'];
  const run = (compile: () => (...a: unknown[]) => unknown) => {
    try {
      return { value: compile()({}, () => undefined, {}, '/f.js', '/') };
    } catch (error) {
      return { error: (error as Error).name };
    }
  };
  expect(run(() => compileCjsFactory([], source, '/app/first.cjs')() as never)).toEqual(
    run(() => compileFunction(source, parameters) as never),
  );
});
