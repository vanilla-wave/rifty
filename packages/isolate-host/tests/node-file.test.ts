/**
 * Goal node-file-entry-parity I4, isolate guest bundle: a fatal program file
 * `require`d from `runCode` (`node -e`) prints the same report as live
 * `node -e` over the same files. The files are written by the code itself, so
 * both sides run the identical source; `<root>` is the oracle temp dir
 * (realpath) and the guest's `/workspace`. Comparison: `nodeFileExpected`
 * (tests/browser-unit/fixtures/node-file-programs.ts), plus Node's own
 * `[eval]-wrapper` frames under its projection (1). Open rows run as `it.fails`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fatalPrograms,
  nodeFileExpected,
  nodeFileNormalized,
  nodeFileRacy,
} from '../../../tests/browser-unit/fixtures/node-file-programs.ts';
import { runCode } from '../src/index.ts';

const GUEST_ROOT = '/workspace';
const RIFTY_VERSION = 'v24.0.0';

/** Rows whose program shape `node -e require(...)` can carry (CJS file entries). */
const programs = fatalPrograms.filter(
  (program) =>
    !program.argv[0]?.endsWith('.mjs') && program.files[program.argv[0] ?? ''] !== undefined,
);

/** Rows at parity in the isolate guest; the others still differ (`it.fails`). */
const LANDED = new Set([
  'throw-top-level',
  'throw-nested-function',
  'type-error-runtime',
  'reference-error',
  'throw-in-dependency',
  'throw-from-async-function',
  'unhandled-rejection-error',
  'unhandled-rejection-non-error',
  'error-with-cause',
  'syntax-error-entry',
  'throw-from-timer',
  'error-with-props',
  'fatal-with-queued-in-callback',
]);
const OPEN = new Set(
  programs
    .map((program) => program.name)
    .filter((name) => !LANDED.has(name) && nodeFileRacy[name] === undefined),
);

function codeFor(files: Readonly<Record<string, string>>, main: string): string {
  return `const fs = require('fs'); for (const [p, c] of Object.entries(${JSON.stringify(files)})) { fs.mkdirSync(require('path').dirname(p), { recursive: true }); fs.writeFileSync(p, c); } require('./${main}');`;
}

function oracle(code: string): {
  root: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'isolate-node-file-')));
  try {
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: root,
      env: {},
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { root, stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Node's own `[eval]-wrapper` script frames: projection (1), Node source rifty lacks. */
function withoutEvalWrapper(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !/^\s+at (?:.* \()?\[eval\]-wrapper:\d+:\d+\)?$/u.test(line))
    .join('\n');
}

describe('node -e require(file) fatal report matches Node (isolate guest)', () => {
  for (const program of programs) {
    const test = OPEN.has(program.name) ? it.fails : it;
    test(program.name, async () => {
      const code = codeFor(program.files, program.argv[0] ?? '');
      const raw = oracle(code);
      const expected = nodeFileExpected(
        { ...raw, stderr: withoutEvalWrapper(raw.stderr) },
        RIFTY_VERSION,
      );
      const result = await runCode(code);
      expect(result.termination).toBeUndefined();
      const actual = nodeFileNormalized(result, GUEST_ROOT);
      const racy = nodeFileRacy[program.name];
      if (racy === undefined) expect(actual).toEqual(expected);
      else {
        // A race between due timers: Node's stderr and status, a declared stdout residual.
        expect({ ...actual, stdout: '' }).toEqual({ ...expected, stdout: '' });
        expect([expected.stdout, `${expected.stdout}${racy}`]).toContain(actual.stdout);
      }
    });
  }
});
