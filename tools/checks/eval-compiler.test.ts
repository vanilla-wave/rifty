import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('keeps the pinned compiler API equal to upstream without touching the host Node environment', () => {
  const compilerUrl = pathToFileURL(
    resolve('packages/runtime-js/src/module-loader/generated/typescript-browser.js'),
  ).href;
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
import assert from 'node:assert/strict';
import upstream from 'typescript';
const before = Object.getOwnPropertyDescriptor(globalThis, 'process');
let calls = 0;
globalThis.require = () => { calls++; throw new Error('compiler used guest require'); };
const { default: browser } = await import(${JSON.stringify(compilerUrl)});
assert.equal(browser.sys, undefined);
assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'process'), before);
for (const source of [
  'const value: number = 42;', 'value as number', 'const value = ;',
  'interface X { value: number }', 'function f<T>(value?: T): T { return value! }',
  'import type { Value } from "pkg"', 'class X { readonly value!: number }',
  'const value = {x: 1} satisfies {x: number};', 'return 1;', '@dec class X {}',
]) {
  const options = { fileName: '[eval].ts', reportDiagnostics: true,
    compilerOptions: { module: upstream.ModuleKind.None, target: upstream.ScriptTarget.ESNext } };
  const expected = upstream.transpileModule(source, options);
  const actual = browser.transpileModule(source, options);
  const diagnostics = (result) => result.diagnostics.map(({code,category,start,length,messageText}) => ({code,category,start,length,messageText}));
  assert.equal(actual.outputText, expected.outputText);
  assert.deepEqual(diagnostics(actual), diagnostics(expected));
  assert.equal(browser.createSourceFile('[eval].ts', source, browser.ScriptTarget.Latest, true).statements.length,
    upstream.createSourceFile('[eval].ts', source, upstream.ScriptTarget.Latest, true).statements.length);
}
assert.equal(calls, 0);
console.log('compiler parity and host identity pass');
`,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(output.trim()).toBe('compiler parity and host identity pass');
});
