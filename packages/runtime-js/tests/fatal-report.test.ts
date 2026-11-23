/**
 * The fatal report against live Node (goal node-file-entry-parity I2): Node's
 * report without its header (V8's message location is not readable from JS,
 * ADR-0445 2026-11-22, compat process.md), frames and props as Node's.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import {
  nodeFileExpected,
  nodeFileNormalized,
  runNodeFileOracle,
} from '../../../tests/browser-unit/fixtures/node-file-programs.ts';
import { formatFatalReport } from '../src/builtins/fatal-report.ts';
import { fatalReportText } from '../src/builtins/process-lifecycle-events.ts';
import { createModuleLoader } from '../src/module-loader/loader.ts';

afterEach(() => resetSyncMirror());

function riftyReport(source: string): string {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': source });
  setSyncMirror(vfs);
  try {
    createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js');
  } catch (error) {
    // What every host prints: the report, or its fallback.
    return fatalReportText(error);
  }
  throw new Error('program did not throw');
}

async function againstNode(source: string): Promise<{ node: string; rifty: string }> {
  const oracle = await runNodeFileOracle({
    name: 'unit',
    files: { 'main.js': source },
    argv: ['main.js'],
  });
  return {
    node: nodeFileExpected(oracle, 'v24.0.0').stderr,
    rifty: nodeFileNormalized({ stdout: '', stderr: riftyReport(source), exitCode: 1 }, '/p')
      .stderr,
  };
}

const headerOf = (report: string) => report.split('\n\n')[0];

it.each([
  [
    'a catch that rethrows its parameter',
    "try {\n  JSON.parse('{');\n} catch (err) {\n  err.seen = 1;\n  throw err;\n}\n",
  ],
  [
    'an error built, decorated, then thrown',
    "const e = new TypeError('x');\ne.code = 'E';\nthrow e;\n",
  ],
  [
    'a method named eval keeps its name',
    "class Calc { eval() { throw new Error('m'); } }\nnew Calc().eval();\n",
  ],
  ['a V8 throw inside a callback', '[1].forEach(() => {\n  null.x;\n});\n'],
])('%s: Node bytes but the header', async (_, source) => {
  const { node, rifty } = await againstNode(source);
  expect(headerOf(node)).toMatch(/^<root>\/main\.js:\d+\n/u);
  expect(rifty).toBe(node.slice(node.indexOf('\n\n') + 2));
});

it.each([
  [
    'the catch hands the error on',
    "function again(e) { throw e; }\ntry {\n  JSON.parse('{');\n} catch (err) {\n  again(err);\n}\n",
  ],
  [
    'the catch may swallow and something else rethrows',
    "let saved;\ntry {\n  JSON.parse('{');\n} catch (err) {\n  saved = err;\n}\nthrow saved;\n",
  ],
  [
    'the built error leaves through an argument',
    "function fail(e) { throw e; }\nconst e = new Error('x');\nfail(e);\n",
  ],
  [
    'the built error leaves through an alias past an unrun throw',
    "const e = new Error('x');\nconst box = [e];\nif (box.length === 0) throw e;\nthrow box[0];\n",
  ],
  [
    'a finally swallowed the first throw',
    "let saved;\nfunction f() {\n  try {\n    throw (saved = new Error('x'));\n  } finally {\n    return;\n  }\n}\nf();\nthrow saved;\n",
  ],
  [
    'a runtime function caught the first throw',
    "const assert = require('node:assert');\nlet saved;\nassert.throws(() => {\n  throw (saved = new Error('x'));\n});\nthrow saved;\n",
  ],
  [
    'a closure may throw the built error later',
    "const e = new Error('x');\nconst later = () => { throw e; };\nlater();\n",
  ],
])('%s: Node bytes but the header', async (_, source) => {
  const { node, rifty } = await againstNode(source);
  expect(headerOf(node)).toMatch(/^<root>\/main\.js:\d+\n/u);
  expect(rifty).toBe(node.slice(node.indexOf('\n\n') + 2));
});

it("a CJS top-level frame reads Node's name in the guest's own err.stack", async () => {
  const source = "const n = 1;\nconsole.log(new Error('s').stack.split('\\n')[1]);\n";
  const oracle = await runNodeFileOracle({
    name: 'unit',
    files: { 'main.js': source },
    argv: ['main.js'],
  });
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': source });
  setSyncMirror(vfs);
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js');
  } finally {
    console.log = log;
  }
  expect(`${lines.join('\n').replaceAll('/p', '<root>')}\n`).toBe(
    nodeFileNormalized(oracle, oracle.root).stdout,
  );
});

function riftyFiles(files: Record<string, string>): string {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(Object.fromEntries(Object.entries(files).map(([k, v]) => [`/p/${k}`, v])));
  setSyncMirror(vfs);
  try {
    createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js');
  } catch (error) {
    return formatFatalReport(error);
  }
  throw new Error('program did not throw');
}

it.each([
  [
    'an async function held the error before the rethrow',
    "let saved;\n(async () => {\n  throw (saved = new Error('x'));\n})().catch(() => {});\nthrow saved;\n",
  ],
  [
    'a promise executor held the error before the rethrow',
    "let saved;\nnew Promise(() => {\n  throw (saved = new Error('x'));\n}).catch(() => {});\nthrow saved;\n",
  ],
])('%s: Node bytes but the header', async (_, source) => {
  const { node, rifty } = await againstNode(source);
  expect(headerOf(node)).toMatch(/^<root>\/main\.js:5\n/u);
  expect(rifty).toBe(node.slice(node.indexOf('\n\n') + 2));
});

it('an object with a captured stack is inspected, not reported as an Error', async () => {
  const source =
    "class AppError {\n  constructor(m) {\n    this.message = m;\n    Error.captureStackTrace(this);\n  }\n}\nthrow new AppError('x');\n";
  const { node, rifty } = await againstNode(source);
  // Node's non-Error header (blank, `<file>:<line>`, source, caret) is not provable.
  expect(node.split('\n').slice(0, 2)).toEqual(['', '<root>/main.js:7']);
  expect(rifty).toBe(node.split('\n').slice(4).join('\n'));
});

it("a nested error's frames are projected like the report's own, its props and braces kept", () => {
  const report = riftyFiles({ 'main.js': "throw { inner: new Error('x'), code: 7 };\n" });
  expect(report).not.toMatch(/\/src\/|compileCjsSource|loader\.ts/u);
  expect(report).toContain('at Object.<anonymous> (/p/main.js:1:16)');
  expect(report).toMatch(/code: 7 \}\n\nNode\.js/u);
  const limited = riftyFiles({
    'main.js': "Error.stackTraceLimit = 1;\nthrow { inner: new Error('x'), code: 7 };\n",
  });
  Error.stackTraceLimit = 10;
  expect(limited).toMatch(/code: 7 \}\n\nNode\.js/u);
});

it('a rejection held by a promise reaction: Node bytes but the header', async () => {
  const head = "const p = Promise.resolve().then(() => {\n  throw new Error('x');\n});\n";
  const oracle = await runNodeFileOracle({
    name: 'unit',
    files: { 'main.js': `${head}p.catch((err) => setTimeout(() => { throw err; }));\n` },
    argv: ['main.js'],
  });
  const node = nodeFileExpected(oracle, 'v24.0.0').stderr;
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': `${head}p.catch(() => {});\nmodule.exports = p;\n` });
  setSyncMirror(vfs);
  const held = createModuleLoader(vfs, { cwd: '/p' }).require(
    './main.js',
    '/p/x.js',
  ) as Promise<void>;
  const error = await held.then(
    () => null,
    (reason: unknown) => reason,
  );
  const rifty = nodeFileNormalized(
    { stdout: '', stderr: formatFatalReport(error), exitCode: 1 },
    '/p',
  ).stderr;
  expect(headerOf(node)).toMatch(/^<root>\/main\.js:4\n/u);
  expect(rifty).toBe(node.slice(node.indexOf('\n\n') + 2));
});

it.each([
  ['an error that is its own cause', "const e = new Error('x');\ne.cause = e;\nthrow e;\n"],
  [
    'an enumerable getter that throws',
    "const e = new Error('x');\nObject.defineProperty(e, 'bad', { enumerable: true, get() { throw new Error('g'); } });\nthrow e;\n",
  ],
  [
    'an enumerable getter that never returns',
    "const e = new Error('x');\nObject.defineProperty(e, 'spin', { enumerable: true, get() { for (;;) {} } });\nthrow e;\n",
  ],
  [
    'a subclass hiding the name',
    "class NotFound extends Error {}\nthrow new NotFound('missing');\n",
  ],
  ['a subclass carrying the name', "class MyError extends Error {}\nthrow new MyError('m');\n"],
  [
    'nested getters, holes and a long list',
    "const e = new Error('x');\ne.detail = { get ran() { console.log('RAN'); return 1; }, a: { get bad() { throw new Error('g'); } } };\ne.holes = new Array(1e5);\nthrow e;\n",
  ],
  ['symbol-keyed props', "const e = new Error('x');\ne[Symbol('k')] = 1;\ne.a = 2;\nthrow e;\n"],
  [
    'an array element getter',
    "const e = new Error('x');\ne.list = [1, 2];\nObject.defineProperty(e.list, 0, { get() { console.log('RAN'); throw new Error('g'); } });\nthrow e;\n",
  ],
  [
    'a cause chain deeper than the report inspects',
    "let e = new Error('leaf');\nfor (let i = 0; i < 5000; i++) e = new Error('e' + i, { cause: e });\nthrow e;\n",
  ],
  [
    'a cause whose Proxy traps throw',
    "const trap = () => {\n  throw new Error('trap');\n};\nthrow new Error('x', { cause: new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }) });\n",
  ],
  [
    'a stack getter that throws',
    "const e = new Error('x');\nObject.defineProperty(e, 'stack', { get() { throw new Error('boom'); } });\nthrow e;\n",
  ],
  [
    'a hand-written stack',
    "const e = new Error('x');\ne.stack = 'Error: x\\n    at fake (z.js:1:1)';\nthrow e;\n",
  ],
])('%s: Node bytes but the header', async (_, source) => {
  const { node, rifty } = await againstNode(source);
  expect(rifty).toBe(node.slice(node.indexOf('\n\n') + 2));
});

it('code compiled from a string keeps its frame, never a rifty path', () => {
  const report = riftyReport(
    "const n = 1;\nconst f = new Function('a', 'const b = 1;\\nthrow new Error(a);');\nf('x');\n",
  );
  expect(report).toContain('    at eval (eval at <anonymous>, <anonymous>:4:7)\n');
  expect(report).not.toMatch(/function-import-routing|\/src\//u);
});

it("a direct eval frame names its module as origin, without Node's position", () => {
  const report = riftyReport('eval(\'function f() {\\n  throw new Error("ev");\\n}\\nf();\');\n');
  expect(report).toContain('    at f (eval at <anonymous> (/p/main.js), <anonymous>:2:9)\n');
});

it.each([
  ['Buffer', "require('buffer').Buffer.from([1])"],
  ['Date', 'new Date(0)'],
  ['RegExp', '/r/'],
])('a %s prop: its own getter never runs', (_, make) => {
  const report = riftyReport(
    `const v = ${make};\nObject.defineProperty(v, 'x', { enumerable: true, get() { globalThis.__riftyGetterRan = true; return 7; } });\nObject.defineProperty(v, 'toISOString', { get() { globalThis.__riftyGetterRan = true; return () => ''; } });\nconst e = new Error('x');\ne.v = v;\nthrow e;\n`,
  );
  expect(Reflect.get(globalThis, '__riftyGetterRan')).toBeUndefined();
  expect(report).not.toContain('x: 7');
  Reflect.deleteProperty(globalThis, '__riftyGetterRan');
});

it("require() of a top-level-await module reads Node's `Error [ERR_REQUIRE_ASYNC_MODULE]:` head", async () => {
  const files = {
    'main.js': "require('./tla.mjs');\n",
    'tla.mjs': 'await 1;\nexport const a = 1;\n',
  };
  const oracle = await runNodeFileOracle({ name: 'unit', files, argv: ['main.js'] });
  const head = (text: string) =>
    text
      .split('\n')
      .find((line) => line.startsWith('Error'))
      ?.split(':')[0];
  const report = riftyFiles(files);
  expect(head(report)).toBe('Error [ERR_REQUIRE_ASYNC_MODULE]');
  expect(head(report)).toBe(head(nodeFileExpected(oracle, 'v24.0.0').stderr));
});

it('a non-enumerable `cause` accessor prints `[cause]: [Getter]` and never runs', () => {
  const report = riftyReport(
    "const e = new Error('x');\nObject.defineProperty(e, 'cause', { get() { globalThis.__riftyCauseRan = true; return 1; } });\nthrow e;\n",
  );
  expect(report).toMatch(/\{\n {2}\[cause\]: \[Getter\]\n\}/u);
  expect(Reflect.get(globalThis, '__riftyCauseRan')).toBeUndefined();
});
