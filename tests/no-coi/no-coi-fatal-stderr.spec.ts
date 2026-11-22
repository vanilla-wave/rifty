import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import {
  type ProcessLifecycleCase,
  runLifecycleOracle,
} from '../browser-unit/fixtures/process-lifecycle-cases.ts';

// A no-COI project command whose `node` dies of a synchronous fatal error
// prints Node v24's fatal report and exits with its status. Node:
// src/node_errors.cc TriggerUncaughtException → ReportFatalException
// (GetErrorSource header, the inspected error, `Node.js vX` trailer). Each row
// runs verbatim in live Node (the oracle) and as the same project command line.
//
// Normalized: the oracle cwd and `/fatal-stderr` → `<root>` (also inside
// `file://` URLs); frames outside `<root>`/`[eval]` (Node's `node:internal`,
// rifty's host modules) are dropped; the trailer keeps the major version.
// Compared: exit status and every FatalShape field. A field rifty does not
// reproduce on any host is a declared residual (compat process.md, "Fatal
// error stderr bytes"): rifty prints exactly the declared value and Node does
// not, so any other output or a fix fails until the declaration changes.

const ROOT = '/fatal-stderr';

interface FatalShape {
  /** GetErrorSource: `<file>:<line>`, source line, caret. */
  readonly header: string | null;
  /** The printed error before its frames (name, message, continuation lines). */
  readonly error: string;
  /** The error is printed with its stack (any frame, internal ones included). */
  readonly stack: boolean;
  /** First frame located in `<root>` or `[eval]`. */
  readonly userFrame: string | null;
  /** Inspected own properties (`{ code, requireStack }`). */
  readonly props: string | null;
  /** The non-Error `--trace-uncaught` hint line. */
  readonly hint: boolean;
  readonly trailer: string | null;
}

interface FatalRow extends ProcessLifecycleCase {
  /** Rifty's declared value of each field that differs from Node. */
  readonly residual: Partial<FatalShape>;
}

const FRAME = /^\s+at /u;
const CARET = /^\s*\^+\s*$/u;
const HINT = /^\(Use `node --trace-uncaught \.\.\.` to show where the exception was thrown\)$/u;
const TRAILER = /^Node\.js (v\d+)\.\d+\.\d+$/u;

function fatalShape(stderr: string, root: string): FatalShape {
  const lines = stripVTControlCharacters(stderr)
    .replaceAll('\r', '')
    .replaceAll(root, '<root>')
    .split('\n');
  const trim = () => {
    while (lines[0] === '') lines.shift();
    while (lines.at(-1) === '') lines.pop();
  };
  trim();
  const version = lines.at(-1)?.match(TRAILER)?.[1];
  if (version !== undefined) lines.pop();
  trim();
  const hintAt = lines.findIndex((line) => HINT.test(line));
  if (hintAt !== -1) lines.splice(hintAt, 1);
  const header = CARET.test(lines[2] ?? '') ? lines.splice(0, 3).join('\n') : null;
  trim();
  let props: string | null = null;
  const close = lines.lastIndexOf('}');
  const open = lines.findLastIndex((line, index) => index < close && /(?:^| )\{$/u.test(line));
  if (close !== -1 && open !== -1) {
    props = lines
      .slice(open + 1, close)
      .map((line) => line.trim())
      .join('\n');
    const opener = (lines[open] ?? '').replace(/ ?\{$/u, '');
    lines.splice(open, close - open + 1, ...(opener === '' ? [] : [opener]));
  }
  const firstFrame = lines.findIndex((line) => FRAME.test(line));
  const frames = firstFrame === -1 ? [] : lines.slice(firstFrame);
  return {
    header,
    error: (firstFrame === -1 ? lines : lines.slice(0, firstFrame)).join('\n'),
    stack: frames.length > 0,
    userFrame:
      frames
        .find((line) => /<root>|\[eval\]/u.test(line) && !/node:internal/u.test(line))
        ?.trim() ?? null,
    props,
    hint: hintAt !== -1,
    trailer: version === undefined ? null : `Node.js ${version}`,
  };
}

// Residuals (byte parity for file entries: node-file-parity.spec.ts): a
// synchronous file-entry throw prints no header; an ES module entry no header and its shifted frame (compat modules.md "ESM
// stack positions"), its compile error the loader's ModuleLoadError; a
// non-Error throw has no header; Node's eval `require()` miss header names its
// own loader source.
const rows: readonly FatalRow[] = [
  {
    name: 'cjs-entry-throw',
    files: { 'fail.cjs': "throw new Error('boom');\n" },
    nodeArgv: ['fail.cjs'],
    // A synchronous throw has no header: V8's throw site is not readable from JS.
    residual: { header: null },
  },
  {
    name: 'eval-throw',
    files: {},
    nodeArgv: ['-e', "throw new Error('boom')"],
    line: `node -e "throw new Error('boom')"`,
    residual: {},
  },
  {
    name: 'esm-entry-throw',
    files: { 'fail.mjs': "throw new Error('boom');\n" },
    nodeArgv: ['fail.mjs'],
    residual: { header: null, userFrame: 'at eval (<root>/fail.mjs:6:7)' },
  },
  {
    name: 'cjs-syntax-error',
    files: { 'syntax.cjs': 'const a = 1;\nlet x = ;\n' },
    nodeArgv: ['syntax.cjs'],
    // Node's only frames are its own loader's (`node:internal/…`). No header
    // (ADR-0445 2026-11-22): rifty's parser position line instead.
    residual: {
      header: null,
      error: "SyntaxError: Unexpected token ';'\n    (rifty parser position: <root>/syntax.cjs:2:9)",
      stack: false,
    },
  },
  {
    name: 'esm-syntax-error',
    files: { 'syntax.mjs': 'const a = 1;\nlet x = ;\n' },
    nodeArgv: ['syntax.mjs'],
    residual: {
      header: null,
      error:
        'ModuleLoadError: Failed to parse ESM source for <root>/syntax.mjs: Unexpected token (2:8)',
      stack: false,
      props:
        "code: 'SYNTAX_ERROR',\nspecifier: '<root>/syntax.mjs',\nimporter: '<root>/syntax.mjs',\nrequireStack: undefined",
    },
  },
  {
    name: 'eval-module-not-found',
    files: {},
    nodeArgv: ['-e', "require('missing-pkg')"],
    line: `node -e "require('missing-pkg')"`,
    // Node's header names its own loader source (`node:internal/…`); inspect
    // breaks Node's long temp path onto lines, not the short `/fatal-stderr` one.
    residual: {
      header: null,
      props: "code: 'MODULE_NOT_FOUND',\nrequireStack: [ '<root>/[eval]' ]",
    },
  },
  {
    name: 'non-error-throw',
    files: { 'throw-number.cjs': 'throw 42;\n' },
    nodeArgv: ['throw-number.cjs'],
    // No stack locates a non-Error throw.
    residual: { header: null },
  },
];

for (const row of rows) {
  test(`project command prints Node's sync fatal report: ${row.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    const oracle = await runLifecycleOracle(row);
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, projectRoot, files, line }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        try {
          await sandbox.fs.writeFile(`${projectRoot}/.keep`, '');
          for (const [path, content] of Object.entries(files)) {
            await sandbox.fs.writeFile(`${projectRoot}/${path}`, content);
          }
          const done = await sandbox.project({ root: projectRoot }).run(line).completion;
          return {
            status: done.status,
            exitCode: done.exitCode,
            worker: done.worker,
            stderr: done.stderr,
          };
        } finally {
          sandbox.dispose();
        }
      },
      {
        root: process.cwd().replaceAll('\\', '/'),
        projectRoot: ROOT,
        files: row.files,
        line: row.line ?? `node ${row.nodeArgv.join(' ')}`,
      },
    );
    await test.info().attach('fatal-stderr', {
      body: JSON.stringify({ node: oracle.version, oracle, observed }, null, 2),
      contentType: 'application/json',
    });
    const node = fatalShape(oracle.stderr, oracle.root);
    const rifty = fatalShape(observed.stderr, ROOT);
    const label = `${row.name} vs Node ${oracle.version}\n--- node\n${oracle.stderr}\n--- rifty\n${observed.stderr}`;
    const declared = row.residual as Readonly<Record<string, unknown>>;
    const compared = (shape: FatalShape) =>
      Object.fromEntries(Object.entries(shape).filter(([field]) => !(field in declared)));
    expect(
      { status: observed.status, exitCode: observed.exitCode, ...compared(rifty) },
      label,
    ).toEqual({ status: 'exited', exitCode: oracle.code, ...compared(node) });
    for (const [field, value] of Object.entries(declared)) {
      const key = field as keyof FatalShape;
      expect(rifty[key], `${label}\ndeclared residual ${field}`).toEqual(value);
      expect(node[key], `${label}\nNode now prints the declared ${field}`).not.toEqual(value);
    }
  });
}
