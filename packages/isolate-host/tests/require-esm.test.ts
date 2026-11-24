/**
 * Unit `runtime-js/isolate-require-esm-syntax-gaps`: with no ES module loader the guest's
 * `require` behaves as Node 24 launched with `--no-require-module` — the oracle here, live,
 * over the same files. `<root>` = the oracle's cwd (realpath) and the guest's `/workspace`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { closureFiles, inNode, inSandbox } from './package-closure.ts';

const FLAG = '--no-require-module';

const FILES: Readonly<Record<string, string>> = {
  'm.mjs': 'export const a = 1;',
  'pk/package.json': '{}',
  'pk/m.mjs': 'export const a = 1;',
  'n.mjs': 'var x = 1;',
  'tm/package.json': '{"type":"module"}',
  'tm/x.js': 'export const a = 1;',
  'tm/v.js': 'var x = 1;',
  'tm/r.js': 'let require = 1;',
  'tm/m.mjs': 'export const a = 1;',
  'node_modules/esmpkg/package.json': '{"type":"module","main":"i.js"}',
  'node_modules/esmpkg/i.js': 'export default 1;',
  's.js': 'export const a = 1;',
  'b.js': 'let require = 1;',
  'd.js': 'const exports = 1;',
  'a.cjs': 'let require = 1;',
  'e.cjs': 'export const a = 1;',
  'node_modules/dual/package.json':
    '{"name":"dual","exports":{".":{"module-sync":"./r.mjs","default":"./i.js"}}}',
  'node_modules/dual/r.mjs': 'export default "esm";',
  'node_modules/dual/i.js': 'module.exports = "cjs";',
};

const ESM_ROWS = [
  './m.mjs',
  './pk/m.mjs',
  './n.mjs',
  './tm/x.js',
  './tm/v.js',
  './tm/r.js',
  './tm/m.mjs',
  'esmpkg',
];
const SYNTAX_ROWS = ['./s.js', './b.js', './d.js', './a.cjs', './e.cjs'];

/** Run by `require` from `-e` and from `probe.js`: one JSON row per case. */
const PROBE = `
const path = require('path');
const show = (e) => e === null || typeof e !== 'object' ? ['thrown', String(e)] : [
  e.constructor === Error ? 'Error' : e.constructor.name, e.name, e.code ?? null, e.message,
  String(e.stack).split('\\n')[0], Object.getOwnPropertyNames(e), String(e).split('\\n')[0],
];
const rows = [['features', process.features.require_module]];
for (const f of ${JSON.stringify([...ESM_ROWS, ...SYNTAX_ROWS, 'dual'])}) {
  try { rows.push([f, 'value', JSON.stringify(require(f))]); } catch (e) { rows.push([f, show(e)]); }
}
rows.push(['resolve', require.resolve('dual')]);
// The default .js hook called directly with no parent module (rifty cannot build a Module
// with one: backlog/runtime-js/node-module-builtin-module-class).
for (const f of ['./tm/v.js', './tm/x.js', './m.mjs']) {
  const abs = path.resolve(f);
  try { require.extensions['.js']({}, abs); rows.push(['hook', f, 'loaded']); }
  catch (e) { rows.push(['hook', f, show(e)]); }
}
console.log(JSON.stringify(rows).split(process.cwd()).join('<root>'));
`;

type Row = readonly unknown[];

const writeFiles = `const fs = require('fs'); for (const [p, c] of Object.entries(${JSON.stringify(FILES)})) { fs.mkdirSync(require('path').dirname(p), { recursive: true }); fs.writeFileSync(p, c); }`;

function nodeEvalIn(code: string): { stdout: string; stderr: string; exitCode: number | null } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'isolate-require-esm-')));
  try {
    const r = spawnSync(process.execPath, [FLAG, '-e', code], {
      cwd: root,
      env: {},
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { stdout: r.stdout, stderr: r.stderr.split(root).join('<root>'), exitCode: r.status };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fileMap = (extra: Readonly<Record<string, string>> = {}): Map<string, Uint8Array> =>
  new Map(Object.entries({ ...FILES, ...extra }).map(([p, c]) => [p, new TextEncoder().encode(c)]));

/**
 * The CJS compile error stays rifty's `ModuleLoadError` wrapper around V8's message on every
 * host (`backlog/runtime-js/module-compile-error-node-syntax-error`, user-deferred): the pin
 * built from Node's row, so a fix of that unit turns it red.
 */
function pinSyntaxRow(row: Row): Row {
  const [f, e] = row as [string, unknown[]];
  expect(e.slice(0, 3)).toEqual(['SyntaxError', 'SyntaxError', null]);
  return [
    f,
    [
      'ModuleLoadError',
      'ModuleLoadError',
      'SYNTAX_ERROR',
      `Failed to compile CJS module <root>/${f.slice(2)}: ${e[3] as string}`,
    ],
  ];
}

function compare(node: Row[], guest: Row[]): void {
  const syntax = new Set(SYNTAX_ROWS);
  const project = (row: Row): Row =>
    syntax.has(row[0] as string) ? [row[0], (row[1] as unknown[]).slice(0, 4)] : row;
  expect(guest.map(project)).toEqual(
    node.map((row) => (syntax.has(row[0] as string) ? pinSyntaxRow(row) : row)),
  );
}

/** Node's "Failed to load the ES module" warning: absent in rifty (`backlog/runtime-js/cjs-esm-syntax-load-warning`). */
function expectNodeWarnings(stderr: string): void {
  for (const f of SYNTAX_ROWS) {
    expect(stderr).toContain(
      `Warning: Failed to load the ES module: <root>/${f.slice(2)}. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.`,
    );
  }
}

describe('isolate require as Node --no-require-module', () => {
  it('from -e: features, ERR_REQUIRE_ESM rows, SyntaxError rows, module-sync, the .js hook without a parent', async () => {
    const code = `${writeFiles}\n${PROBE}`;
    const node = nodeEvalIn(code);
    expect(node.exitCode, node.stderr).toBe(0);
    expectNodeWarnings(node.stderr);
    const guest = await runCode(code);
    expect(guest.stderr).not.toContain('URLConstructor');
    expect({ exitCode: guest.exitCode, stderr: guest.stderr }).toEqual({ exitCode: 0, stderr: '' });
    compare(JSON.parse(node.stdout) as Row[], JSON.parse(guest.stdout) as Row[]);
  });

  it('from a file (node probe.js)', { timeout: 60_000 }, async () => {
    const files = fileMap({ 'probe.js': PROBE });
    const node = inNode(files, 'probe.js', 'out/none', [FLAG]);
    expect(node.exitCode, node.stderr).toBe(0);
    const guest = await inSandbox(files, 'probe.js', 'out/none');
    expect({ exitCode: guest.exitCode, stderr: guest.stderr }).toEqual({ exitCode: 0, stderr: '' });
    compare(JSON.parse(node.stdout) as Row[], JSON.parse(guest.stdout) as Row[]);
  });

  it('an uncaught ERR_REQUIRE_ESM prints Node’s head and code', { timeout: 60_000 }, async () => {
    const files = fileMap({ 'main.js': "require('./tm/x.js');" });
    const node = inNode(files, 'main.js', 'out/none', [FLAG]);
    const head =
      'Error [ERR_REQUIRE_ESM]: require() of ES Module /workspace/tm/x.js from /workspace/main.js not supported.';
    expect(node.exitCode).toBe(1);
    expect(node.stderr).toMatch(
      /Error \[ERR_REQUIRE_ESM\]: require\(\) of ES Module .*tm\/x\.js from /,
    );
    expect(node.stderr).toContain("code: 'ERR_REQUIRE_ESM'");
    const guest = await inSandbox(files, 'main.js', 'out/none');
    expect(guest.exitCode).toBe(1);
    expect(guest.stderr.startsWith(head), guest.stderr).toBe(true);
    expect(guest.stderr).toContain("code: 'ERR_REQUIRE_ESM'");
  });
});

describe('isolate ES modules stay named gaps, no URLConstructor', () => {
  for (const entry of ['m.mjs', 'tm/x.js', 'b.js']) {
    it(`node ${entry}`, { timeout: 60_000 }, async () => {
      const files = fileMap();
      expect(inNode(files, entry, 'out/none', [FLAG]).exitCode).toBe(0);
      const guest = await inSandbox(files, entry, 'out/none');
      expect(guest.exitCode).toBe(1);
      expect(guest.stderr).toMatch(/^NotImplementedError: Not implemented: isolate-host\.esm /);
      expect(guest.stderr).not.toContain('URLConstructor');
    });
  }

  it('import()', async () => {
    const guest = await runCode(`${writeFiles}\nimport('./m.mjs').then((m) => console.log(m.a));`);
    expect(guest.exitCode).toBe(1);
    expect(guest.stderr).toMatch(/Not implemented: isolate-host\.dynamic-import /);
    expect(guest.stderr).not.toContain('URLConstructor');
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = (name: string): string => realpathSync(join(here, '../node_modules', name));

describe('module-sync dual packages load their CommonJS entry (user scenario)', () => {
  it(
    'is-generator-function 1.1.2 and is-async-function 2.1.1 give Node’s verdicts',
    { timeout: 120_000 },
    async () => {
      const files = new Map([
        ...closureFiles('is-generator-function', pkgRoot('is-generator-function')),
        ...closureFiles('is-async-function', pkgRoot('is-async-function')),
      ]).set('gen.cjs', readFileSync(join(here, 'fixtures/require-esm/gen.cjs')));
      const expected =
        'is-generator-function true false false false\nis-async-function false true false false\n';
      for (const flags of [[], [FLAG]]) {
        expect(inNode(files, 'gen.cjs', 'out/none', flags)).toMatchObject({
          exitCode: 0,
          stdout: expected,
          stderr: '',
        });
      }
      const guest = await inSandbox(files, 'gen.cjs', 'out/none');
      expect(guest).toEqual({ stdout: expected, stderr: '', exitCode: 0 });
    },
  );
});
