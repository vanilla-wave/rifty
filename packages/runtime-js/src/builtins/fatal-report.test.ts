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
} from '../../../../tests/browser-unit/fixtures/node-file-programs.ts';
import { createModuleLoader } from '../module-loader/loader.ts';
import { formatFatalReport } from './fatal-report.ts';

afterEach(() => resetSyncMirror());

function riftyReport(source: string): string {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/p/main.js': source });
  setSyncMirror(vfs);
  try {
    createModuleLoader(vfs, { cwd: '/p' }).require('./main.js', '/p/x.js');
  } catch (error) {
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
    'a closure may throw the built error later',
    "const e = new Error('x');\nconst later = () => { throw e; };\nlater();\n",
  ],
])('%s: no header (Node has one JS cannot prove)', async (_, source) => {
  const { node, rifty } = await againstNode(source);
  expect(headerOf(node)).toMatch(/^<root>\/main\.js:\d+\n/u);
  expect(rifty).toBe(node.slice(node.indexOf('\n\n') + 2));
});
