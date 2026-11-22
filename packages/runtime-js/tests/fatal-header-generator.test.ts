/**
 * The fatal report header is never false (goal node-file-entry-parity I2,
 * manager contract 2026-11-22): generated programs — creation form ×
 * rejection or throw form × call depth × file boundary — run in live Node;
 * one-sided claim: when rifty prints a header it is byte-equal to Node's.
 * The rifty side runs the same files through the real loader; a rejected
 * reason is collected by a handler attached on an appended line, so every
 * creation position is the same on both sides.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterAll, expect, it } from 'vitest';
import {
  nodeFileExpected,
  nodeFileNormalized,
  runNodeFileOracle,
} from '../../../tests/browser-unit/fixtures/node-file-programs.ts';
import { formatFatalReport } from '../src/builtins/fatal-report.ts';
import { createModuleLoader } from '../src/module-loader/loader.ts';

afterAll(() => resetSyncMirror());

/** Error-creating expressions; `here` is evaluated in the program, `dep` in `dep.js`. */
const CREATIONS = [
  { name: 'new-error', here: "new Error('x')" },
  { name: 'call-error', here: "Error('x')" },
  { name: 'type-error', here: "new TypeError('x')" },
  { name: 'factory', here: "mk('x')", prelude: 'function mk(m) {\n  return new Error(m);\n}\n' },
  { name: 'subclass', here: "new (class Bad extends Error {})('x')" },
  {
    name: 'dep',
    here: "require('./dep').make('x')",
    dep: 'exports.make = (m) =>\n  new Error(m);\n',
  },
] as const;

/** How the error becomes fatal; `E` is the creation. Throw forms are synchronous. */
const FORMS = [
  { name: 'reject', rejection: true, code: 'Promise.reject(E)' },
  { name: 'async-throw', rejection: true, code: '(async () => {\n  throw E;\n})()' },
  {
    name: 'async-await-throw',
    rejection: true,
    code: '(async () => {\n  await null;\n  throw E;\n})()',
  },
  { name: 'then-throw', rejection: true, code: 'Promise.resolve().then(() => {\n  throw E;\n})' },
  { name: 'executor', rejection: true, code: 'new Promise((_, reject) => reject(E))' },
  {
    name: 'async-rethrow',
    rejection: true,
    code: '(async () => {\n  try {\n    throw E;\n  } catch (e) {\n    throw e;\n  }\n})()',
  },
  {
    name: 'async-held',
    rejection: true,
    code: '(async () => {\n  const e = E;\n  await null;\n  throw e;\n})()',
  },
  { name: 'throw', rejection: false, code: '(() => {\n  throw E;\n})()' },
  { name: 'throw-held', rejection: false, code: '(() => {\n  const e = E;\n  throw e;\n})()' },
  {
    name: 'throw-rethrow',
    rejection: false,
    code: '(() => {\n  try {\n    throw E;\n  } catch (e) {\n    throw e;\n  }\n})()',
  },
] as const;

const DEPTHS = [0, 1, 2] as const;

interface Program {
  readonly label: string;
  readonly rejection: boolean;
  readonly node: Record<string, string>;
  readonly rifty: Record<string, string>;
}

function wrap(expression: string, depth: number): { readonly head: string; readonly call: string } {
  if (depth === 0) return { head: '', call: expression };
  let head = '';
  let inner = expression;
  for (let d = depth; d >= 1; d -= 1) {
    head += `function f${d}() {\n  return ${d === depth ? inner : `f${d + 1}()`};\n}\n`;
    inner = `f${d}()`;
  }
  return { head, call: 'f1()' };
}

const programs: Program[] = [];
for (const creation of CREATIONS) {
  for (const form of FORMS) {
    for (const depth of DEPTHS) {
      const expression = form.code.replace('E', creation.here);
      const { head, call } = wrap(expression, depth);
      const body = `${'prelude' in creation ? creation.prelude : ''}${head}const p = ${call};\n`;
      const dep = 'dep' in creation ? { 'dep.js': creation.dep } : {};
      programs.push({
        label: `${creation.name} × ${form.name} × depth ${depth}`,
        rejection: form.rejection,
        node: { 'main.js': `${body}void p;\n`, ...dep },
        rifty: { 'main.js': `${body}globalThis.__collect(p);\n`, ...dep },
      });
      // The same program one file away: `lib.js` runs it, `main.js` requires it.
      const lib = body.replaceAll("require('./dep')", "require('./dep')");
      programs.push({
        label: `${creation.name} × ${form.name} × depth ${depth} × required`,
        rejection: form.rejection,
        node: {
          'main.js': "const n = 1;\nrequire('./lib');\n",
          'lib.js': `${lib}void p;\n`,
          ...dep,
        },
        rifty: {
          'main.js': "const n = 1;\nrequire('./lib');\n",
          'lib.js': `${lib}globalThis.__collect(p);\n`,
          ...dep,
        },
      });
    }
  }
}

const HEADER = /^<root>\/[^\n]+:\d+\n/u;
const header = (report: string) => (HEADER.test(report) ? report.split('\n\n')[0] : null);

async function rifty(program: Program): Promise<string> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(
    Object.fromEntries(Object.entries(program.rifty).map(([k, v]) => [`/p/${k}`, v])),
  );
  setSyncMirror(vfs);
  let reason: unknown;
  const scope = globalThis as { __collect?: (p: unknown) => void };
  scope.__collect = (p) => {
    if (p instanceof Promise) p.catch((error: unknown) => (reason = error));
  };
  try {
    createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js');
  } catch (error) {
    reason = error;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  delete scope.__collect;
  const report = formatFatalReport(
    reason,
    program.rejection ? 'unhandledRejection' : 'uncaughtException',
  );
  return nodeFileNormalized({ stdout: '', stderr: report, exitCode: 1 }, '/p').stderr;
}

it(`${programs.length} generated programs: a printed header is Node's`, async () => {
  const wrong: string[] = [];
  let printed = 0;
  for (const program of programs) {
    const oracle = await runNodeFileOracle({
      name: program.label,
      files: program.node,
      argv: ['main.js'],
    });
    const node = nodeFileExpected(oracle, 'v24.0.0').stderr;
    const ours = header(await rifty(program));
    if (ours === null) continue;
    printed += 1;
    if (ours !== header(node))
      wrong.push(`${program.label}\n--- node\n${node}\n--- rifty\n${ours}`);
  }
  expect(wrong).toEqual([]);
  // Rejections whose error frame is guest code do print one (not vacuous).
  expect(printed).toBeGreaterThan(120);
}, 600_000);
