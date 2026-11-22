/**
 * The fatal report's header proofs against live Node (goal
 * node-file-entry-parity I2): where the source proves V8's throw site the
 * report equals Node's under the carrier's normalization; where a value may
 * leave to be thrown elsewhere there is no header, never a guessed one.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import {
  nodeFileExpected,
  nodeFileNormalized,
  runNodeFileOracle,
} from '../../../tests/browser-unit/fixtures/node-file-programs.ts';
import { formatFatalReport, markFatalTaskRoot } from '../src/builtins/fatal-report.ts';
import { dispatchUncaughtException } from '../src/builtins/process-lifecycle-events.ts';
import { NodeProcess } from '../src/builtins/process.ts';
import { createModuleLoader } from '../src/module-loader/loader.ts';

afterEach(() => resetSyncMirror());

function riftyReport(source: string): string {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': source });
  setSyncMirror(vfs);
  try {
    createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js');
  } catch (error) {
    // As runNodeEntry's catch: out of the entry's evaluation, a task root.
    markFatalTaskRoot(error);
    return formatFatalReport(error);
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
])('%s: Node bytes', async (_, source) => {
  const { node, rifty } = await againstNode(source);
  expect(rifty).toBe(node);
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
    'a closure may throw the built error later',
    "const e = new Error('x');\nconst later = () => { throw e; };\nlater();\n",
  ],
])('%s: no header (Node has one JS cannot prove)', async (_, source) => {
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
    // As runNodeEntry's catch: out of the entry's evaluation, a task root.
    markFatalTaskRoot(error);
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
])('%s: no header', async (_, source) => {
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

it('a callback the module itself runs keeps the header', async () => {
  const { node, rifty } = await againstNode(
    "function later(cb) { return cb; }\nconst run = later(() => {\n  throw new Error('x');\n});\nrun();\n",
  );
  expect(rifty).toBe(node);
});

it('a promise reaction may have held the error: no header', async () => {
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

it('an error a listener received and threw again loses its header proof', () => {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': "module.exports = () => {\n  throw new Error('a');\n};\n" });
  setSyncMirror(vfs);
  const fail = createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js') as () => void;
  const caught = (): unknown => {
    try {
      fail();
    } catch (error) {
      markFatalTaskRoot(error);
      return error;
    }
    return null;
  };
  // Control: a marked error the runtime caught at its root has Node's header.
  expect(formatFatalReport(caught())).toMatch(/^\/p\/main\.js:2\n/u);
  const proc = new NodeProcess();
  let printed = '';
  proc.stderr.write = ((chunk: string) => {
    printed += chunk;
    return true;
  }) as typeof proc.stderr.write;
  proc.on('uncaughtException', (error: unknown) => {
    throw error;
  });
  try {
    dispatchUncaughtException(caught(), 'uncaughtException', proc);
  } catch {
    // the exit-7 signal
  }
  expect(printed).toMatch(/^Error: a\n {4}at /u);
});

it('an error that already left a task root is never one again', () => {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': "module.exports = () => {\n  throw new Error('a');\n};\n" });
  setSyncMirror(vfs);
  const fail = createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js') as () => void;
  let error: unknown;
  try {
    fail();
  } catch (caught) {
    error = caught;
  }
  markFatalTaskRoot(error);
  // A listener kept it; a later timer dispatch rethrows the same object.
  const proc = new NodeProcess();
  proc.on('uncaughtException', () => {});
  dispatchUncaughtException(error, 'uncaughtException', proc);
  markFatalTaskRoot(error);
  expect(formatFatalReport(error)).toMatch(/^Error: a\n {4}at /u);
});
