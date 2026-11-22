import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Goal node-file-entry-parity: `node <file>` programs run verbatim in live Node
// (temp dir) and in rifty (`<root>` = the project root). Two surfaces: what the
// entry and its dependencies see (entry semantics), and what a fatal error
// writes to stderr with which status (fatal diagnostics).

export interface NodeFileProgram {
  readonly name: string;
  /** Root-relative files, written to the oracle temp dir and to the rifty project root. */
  readonly files: Readonly<Record<string, string>>;
  /** Argv after `node`; the rifty line is `node <argv joined by spaces>`. */
  readonly argv: readonly string[];
}

const ENTRY_FACTS = `const dep = require('./lib/dep');
const facts = {
  isMain: require.main === module,
  mainId: require.main && require.main.id,
  mainFilename: require.main && require.main.filename,
  mainModule: process.mainModule === module,
  moduleId: module.id,
  filename: module.filename,
  __filename,
  __dirname,
  path: module.path,
  loaded: module.loaded,
  parent: String(module.parent),
  children: module.children.map((child) => child.id),
  argv: process.argv.slice(1),
  cacheHasSelf: require.cache[__filename] === module,
  cacheKeys: Object.keys(require.cache),
  thisIsExports: this === module.exports,
  wrapperArguments: arguments.length,
  resolved: require.resolve('./lib/dep'),
  firstPath: module.paths[0],
  dep,
};
console.log(JSON.stringify(facts, null, 1));
setImmediate(() => console.log(JSON.stringify({ loadedAfterEntry: module.loaded })));
`;

const DEP_FACTS = `module.exports = {
  isMain: require.main === module,
  id: module.id,
  parentId: module.parent && module.parent.id,
  mainId: require.main && require.main.id,
  mainIsCachedEntry: require.main === require.cache[require.main && require.main.filename],
  leaf: require('./sub/leaf').where,
};
`;

const LEAF = 'exports.where = [__filename.slice(__dirname.length), require.main === module];\n';

/** Sources whose meaning depends on the start of the file; `forms.js` requires each. */
const FIRST_LINE_FORMS: Readonly<Record<string, string>> = {
  'forms.js': `const out = {};
for (const name of ['ws', 'cmt', 'mlcmt', 'line2', 'open', 'bang', 'bom', 'strict', 'strict-cmt', 'late', 'bang-ws', 'bom-bang', 'midline']) {
  globalThis.ran = false;
  try {
    out[name] = require('./first/' + name).v;
  } catch (e) {
    out[name] = e.name + ': ' + e.message + (globalThis.ran ? ' (ran)' : '');
  }
}
module.exports = JSON.stringify(out);
`,
  'first/ws.js': '   --> legacy\nexports.v = "ws";\n',
  'first/cmt.js': '/* a */ --> legacy\nexports.v = "cmt";\n',
  'first/mlcmt.js': '/* a\n */ --> legacy\nexports.v = "mlcmt";\n',
  'first/line2.js': 'exports.v = "line2";\n--> legacy\n',
  'first/open.js': '<!-- legacy\nexports.v = "open" <!-- trailing\n;\n',
  'first/bang.js': '#!/usr/bin/env node\nexports.v = "bang";\n',
  'first/bom.js': '\uFEFFexports.v = "bom";\n',
  'first/strict.js': '"use strict";\nexports.v = (function () { return this; })() === undefined;\n',
  'first/strict-cmt.js':
    '/* c */ "use strict";\nexports.v = (function () { return this; })() === undefined;\n',
  'first/late.js':
    'var a;\n"use strict";\nexports.v = (function () { return this; })() === undefined;\n',
  'first/bang-ws.js': ' #!/usr/bin/env node\nglobalThis.ran = true;\n',
  'first/bom-bang.js': '\uFEFF#!/usr/bin/env node\nglobalThis.ran = true;\n',
  'first/midline.js': 'globalThis.ran = true;\nx = 1 --> 0;\n',
};

const entryFiles = {
  'lib/dep.js': DEP_FACTS,
  'lib/sub/leaf.js': LEAF,
};

/** Entry semantics: one program per entry spelling, printing what Node exposes. */
export const entryPrograms: readonly NodeFileProgram[] = [
  {
    name: 'entry-facts',
    files: { 'entry.js': ENTRY_FACTS, ...entryFiles },
    argv: ['entry.js', 'a', 'b'],
  },
  {
    name: 'entry-facts-extensionless',
    files: { 'entry.js': ENTRY_FACTS, ...entryFiles },
    argv: ['./lib/../entry'],
  },
  {
    name: 'entry-main-guard',
    files: {
      'cli.js': `function main() {
  console.log('main ran', process.argv.length);
}
if (require.main === module) main();
module.exports = { main };
`,
    },
    argv: ['cli.js'],
  },
  {
    name: 'entry-directory',
    files: {
      'app/index.js':
        'console.log(JSON.stringify([require.main === module, module.id, __filename, process.argv.slice(1)]));\n',
    },
    argv: ['app'],
  },
  {
    name: 'entry-cjs-extension',
    files: {
      'tool.cjs': "console.log(require.main === module, module.id, require('./lib/x.cjs'));\n",
      'lib/x.cjs': 'module.exports = [require.main === module, module.parent.id];\n',
    },
    argv: ['tool.cjs'],
  },
  {
    name: 'entry-esm-syntax-detection',
    files: {
      'main.js':
        "import { basename } from 'node:path';\nconsole.log(basename(import.meta.filename), typeof require, import.meta.main);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'require-cache-reload',
    files: {
      'main.js': `let first = require('./counter');
const key = require.resolve('./counter');
console.log(require.cache[key].exports === first, require.cache[key].loaded);
delete require.cache[key];
const second = require('./counter');
console.log(first.n, second.n, first === second, require.cache[key].exports === second);
`,
      'counter.js':
        'globalThis.loads = (globalThis.loads || 0) + 1;\nexports.n = globalThis.loads;\n',
    },
    argv: ['main.js'],
  },
  {
    // The wrapper must not change what a file's start means (N3 class).
    name: 'first-line-html-close',
    files: {
      'main.js': '--> legacy comment\nconsole.log("ok", require("./forms"));\n',
      ...FIRST_LINE_FORMS,
    },
    argv: ['main.js'],
  },
  {
    name: 'esm-entry-facts',
    files: {
      'main.mjs': `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
console.log(JSON.stringify({
  url: import.meta.url,
  filename: import.meta.filename,
  dirname: import.meta.dirname,
  main: import.meta.main,
  argv: process.argv.slice(1),
  cjs: require('./lib/cjs.js'),
}, null, 1));
`,
      'lib/cjs.js':
        'module.exports = { main: String(require.main), parent: String(module.parent) };\n',
    },
    argv: ['main.mjs'],
  },
];

/** Fatal diagnostics: every program dies; stderr bytes and status are the contract. */
export const fatalPrograms: readonly NodeFileProgram[] = [
  {
    name: 'throw-top-level',
    files: { 'main.js': "throw new Error('boom');\n" },
    argv: ['main.js'],
  },
  {
    name: 'throw-nested-function',
    files: {
      'main.js':
        "const n = 1;\nfunction fail(value) {\n  throw new RangeError('bad ' + value);\n}\nfail(n);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'type-error-runtime',
    files: { 'main.js': 'const config = undefined;\nconsole.log(config.port);\n' },
    argv: ['main.js'],
  },
  {
    name: 'reference-error',
    files: { 'main.js': 'const a = 1;\n  startServer(a);\n' },
    argv: ['main.js'],
  },
  {
    name: 'throw-in-dependency',
    files: {
      'main.js': "const n = 0;\nrequire('./lib/dep');\n",
      'lib/dep.js': "function f() {\n  throw new TypeError('bad thing');\n}\nf();\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'throw-from-timer',
    files: { 'main.js': "setTimeout(() => {\n  throw new Error('timer');\n}, 1);\n" },
    argv: ['main.js'],
  },
  {
    name: 'throw-from-async-function',
    files: {
      'main.js':
        "async function main() {\n  await null;\n  throw new Error('async');\n}\nmain();\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'unhandled-rejection-error',
    files: { 'main.js': "const p = 1;\nPromise.reject(new Error('rejected'));\n" },
    argv: ['main.js'],
  },
  {
    name: 'unhandled-rejection-non-error',
    files: { 'main.js': 'Promise.reject(42);\n' },
    argv: ['main.js'],
  },
  {
    name: 'throw-non-error-number',
    files: { 'main.js': 'const a = 1;\nthrow 42;\n' },
    argv: ['main.js'],
  },
  {
    name: 'throw-non-error-object',
    files: { 'main.js': 'throw { reason: "nope", code: 7 };\n' },
    argv: ['main.js'],
  },
  {
    name: 'error-with-cause',
    files: {
      'main.js':
        "function load() {\n  throw new Error('inner');\n}\ntry {\n  load();\n} catch (err) {\n  throw new Error('outer', { cause: err });\n}\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'rejection-with-props-cause-subclass',
    files: {
      'main.js':
        "class Bad extends Error {}\nconst e = new Bad('r', { cause: new Error('c') });\ne.code = 'E_X';\nPromise.reject(e);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'rejection-fs-enoent',
    files: { 'main.js': "require('fs').promises.readFile('missing.txt');\n" },
    argv: ['main.js'],
  },
  {
    name: 'rejection-after-stack-read',
    files: {
      'main.js':
        "(async () => {\n  try {\n    throw new Error('x');\n  } catch (e) {\n    console.log('failed:', String(e.stack).split('\\n')[0]);\n    throw e;\n  }\n})();\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'error-hostile-props',
    files: {
      'main.js': `const e = new Error('x');
e.detail = { get ran() { console.log('GETTER RAN'); return 1; }, a: { get bad() { throw new Error('g'); } } };
e.holes = new Array(1e5);
e.list = Array.from({ length: 150 }, (_, i) => i);
throw e;
`,
    },
    argv: ['main.js'],
  },
  {
    name: 'error-deep-cause',
    files: {
      'main.js':
        "let e = new Error('leaf');\nfor (let i = 0; i < 5000; i++) e = new Error('e' + i, { cause: e });\nthrow e;\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'error-throwing-proxy-cause',
    files: {
      'main.js':
        "const trap = () => {\n  throw new Error('trap');\n};\nthrow new Error('x', { cause: new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }) });\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'error-throwing-stack-getter',
    files: {
      'main.js':
        "const e = new Error('x');\nObject.defineProperty(e, 'stack', { get() { throw new Error('boom'); } });\nthrow e;\n",
    },
    argv: ['main.js'],
  },
  { name: 'throw-null', files: { 'main.js': 'const a = 1;\nthrow null;\n' }, argv: ['main.js'] },
  {
    name: 'throw-in-direct-eval',
    files: { 'main.js': 'eval(\'function f() {\\n  throw new Error("ev");\\n}\\nf();\');\n' },
    argv: ['main.js'],
  },
  {
    name: 'error-with-props',
    files: { 'main.js': "const err = new TypeError('x');\nerr.code = 'E_X';\nthrow err;\n" },
    argv: ['main.js'],
  },
  {
    name: 'rethrow-in-catch',
    files: {
      'main.js':
        "function parse() {\n  return JSON.parse('{bad');\n}\ntry {\n  parse();\n} catch (err) {\n  console.log('cleanup');\n  throw err;\n}\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'throw-in-callback',
    files: {
      'main.js': "[1, 2].forEach((n) => {\n  if (n === 2) throw new Error('item ' + n);\n});\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'throw-from-named-timer',
    files: {
      'main.js': "function tick() {\n  throw new Error('tick');\n}\nsetTimeout(tick, 1);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'rethrow-after-import',
    files: {
      'main.js': "import('./dep.js').catch((err) => setTimeout(() => {\n  throw err;\n}, 1));\n",
      'dep.js': "const a = 1;\nthrow new Error('dep');\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'listener-logs-and-rethrows',
    files: {
      'main.js':
        "process.on('uncaughtException', (err) => {\n  console.log('log');\n  throw err;\n});\nsetTimeout(() => {\n  throw new Error('a');\n}, 1);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'listener-rethrows-from-later-timer',
    files: {
      'main.js':
        "process.once('uncaughtException', (e) => {\n  setTimeout(() => {\n    throw e;\n  }, 5);\n});\nsetTimeout(() => {\n  throw new Error('first');\n}, 1);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'fatal-with-queued-timer',
    files: {
      'main.js':
        "setTimeout(() => {\n  throw new Error('a');\n}, 1);\nsetTimeout(() => console.log('queued'), 1);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'fatal-with-queued-in-callback',
    files: {
      'main.js':
        "setTimeout(() => {\n  setTimeout(() => console.log('queued'), 0);\n  setImmediate(() => console.log('immediate'));\n  throw new Error('a');\n}, 1);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'fatal-with-queued-exit-zero',
    files: {
      'main.js':
        "setTimeout(() => {\n  throw new Error('a');\n}, 1);\nsetTimeout(() => process.exit(0), 1);\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'rejection-with-queued-work',
    files: {
      'main.js':
        "Promise.reject(new Error('r'));\nsetTimeout(() => console.log('queued'), 0);\nprocess.nextTick(() => console.log('tick'));\n",
    },
    argv: ['main.js'],
  },
  {
    name: 'syntax-error-entry',
    files: { 'main.js': 'const a = 1;\nlet x = ;\n' },
    argv: ['main.js'],
  },
  {
    name: 'stray-closing-brace',
    files: {
      'main.js':
        'function a() {\n  console.log("a");\n}}\nconsole.log("top");\nfunction b() {\n  console.log("b");\n}\n',
    },
    argv: ['main.js'],
  },
  {
    name: 'stray-brace-closed-later',
    files: { 'main.js': 'console.log("start");\n}\nconsole.log("after");\n{\n' },
    argv: ['main.js'],
  },
  {
    name: 'wrapper-escape',
    files: { 'main.js': 'console.log("inside");\n}); console.log("escaped"); (function () {\n' },
    argv: ['main.js'],
  },
  {
    name: 'syntax-error-dependency',
    files: { 'main.js': "require('./lib/broken');\n", 'lib/broken.js': 'function (\n' },
    argv: ['main.js'],
  },
  {
    name: 'syntax-error-missing-paren',
    files: { 'main.js': 'const a = 1;\nfoo((a) });\n' },
    argv: ['main.js'],
  },
  { name: 'module-not-found-entry', files: {}, argv: ['missing.js'] },
  {
    name: 'module-not-found-dependency',
    files: { 'main.js': "const x = 1;\nrequire('./nope');\n" },
    argv: ['main.js'],
  },
  {
    name: 'module-not-found-package',
    files: { 'main.js': "require('left-pad');\n" },
    argv: ['main.js'],
  },
  {
    name: 'esm-throw',
    files: { 'main.mjs': "const a = 1;\nthrow new Error('esm');\n" },
    argv: ['main.mjs'],
  },
  {
    name: 'esm-syntax-error',
    files: { 'main.mjs': 'const a = 1;\nlet x = ;\n' },
    argv: ['main.mjs'],
  },
];

export interface NodeFileOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/** Live `node <argv>` in a fresh temp dir; `root` is its realpath (macOS `/private/var/…`). */
export async function runNodeFileOracle(
  program: NodeFileProgram,
): Promise<NodeFileOutcome & { readonly root: string; readonly version: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-node-file-'));
  const physical = await realpath(directory);
  try {
    for (const [path, content] of Object.entries(program.files)) {
      await mkdir(dirname(join(physical, path)), { recursive: true });
      await writeFile(join(physical, path), content);
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...program.argv], {
        cwd: physical,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { NO_COLOR: '1', PATH: dirname(process.execPath) },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', reject);
      child.once('close', (exitCode) =>
        resolve({ root: physical, version: process.version, stdout, stderr, exitCode }),
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The one normalization: the oracle temp dir and the rifty project root both
 * read `<root>`. Two declared projections of the ORACLE only (goal
 * node-file-entry-parity §Decisions): (1) Node's own `node:*` source has no
 * rifty counterpart — its frames are deleted, a report header naming it
 * (`node:…:N`, source, caret, blank) is deleted, the `... N lines matching
 * cause stack trace ...` line the frames feed is deleted, and an inspect props
 * opener ` {` on a deleted frame moves to the previous line; nothing else is
 * rewritten (a frameless result keeps its unbracketed header); (2) the trailer
 * names the runtime's own `process.version`.
 */
export function nodeFileExpected(
  oracle: NodeFileOutcome & { readonly root: string },
  riftyVersion: string,
): NodeFileOutcome {
  const kept: string[] = [];
  const lines = oracle.stderr.split('\n');
  // A header naming Node's own source (`node:internal/…:N`, line, caret, blank).
  if (/^node:\S+:\d+$/u.test(lines[0] ?? '')) lines.splice(0, 4);
  for (const line of lines) {
    if (/^\s+\.\.\. \d+ lines? matching cause stack trace \.\.\.$/u.test(line)) continue;
    const internal = /^\s+at (?:async )?(?:.* \()?node:[^)\s]*\)?( \{|,)?$/u.exec(line);
    if (internal === null) kept.push(line);
    // inspect's props opener or list comma on the last frame line moves up a line.
    else if (internal[1] !== undefined) kept.push(`${kept.pop() ?? ''}${internal[1]}`);
  }
  const stderr = kept.join('\n').replace(/^Node\.js v\d+\.\d+\.\d+$/mu, `Node.js ${riftyVersion}`);
  return nodeFileNormalized({ ...oracle, stderr }, oracle.root);
}

/**
 * A rifty project root under `parent` as long as the oracle's temp dir, so
 * util.inspect's 80-column line breaking over printed paths decides alike on
 * both sides of the one `<root>` rewrite.
 */
export function nodeFileRoot(parent: string, name: string, oracleRoot: string): string {
  const width = oracleRoot.length - parent.length;
  if (width < name.length)
    throw new Error(`oracle root ${oracleRoot} is shorter than ${parent}${name}`);
  return `${parent}${name.padEnd(width, '_')}`;
}

export function nodeFileNormalized(outcome: NodeFileOutcome, root: string): NodeFileOutcome {
  const paths = (text: string) => text.split(root).join('<root>');
  return {
    stdout: paths(outcome.stdout),
    stderr: paths(outcome.stderr),
    exitCode: outcome.exitCode,
  };
}

export type NodeFileHost = 'no-COI' | 'COI' | 'isolate';

/**
 * Each row's verdict per host (`node-file-pins.json`): `"node"` — equal to
 * Node; otherwise rifty's exact normalized outcome, which must also still
 * differ from Node, so any change (a fix or a new defect) fails until the pin
 * moves. Every pinned row is a named compat row (process.md "Fatal error
 * stderr bytes", modules.md, isolate-host.md). Regenerate from
 * `NODE_FILE_DUMP` output only after reading the diff.
 */
export const nodeFilePins = JSON.parse(
  readFileSync(new URL('./node-file-pins.json', import.meta.url), 'utf8'),
) as Readonly<Record<NodeFileHost, Readonly<Record<string, NodeFileOutcome | 'node'>>>>;

/**
 * Rows whose rifty outcome races (two timers due in one host turn): the pin
 * holds without stdout, which is the pin's or the declared residual.
 */
export const nodeFileRacy: Readonly<Record<string, string>> = {
  'fatal-with-queued-timer': 'queued\n',
};

interface Expectation {
  toEqual(expected: unknown): void;
  toContain(item: unknown): void;
  not: { toEqual(expected: unknown): void };
}

/**
 * A Node-format report header's first line (`<file>:<line>` alone, unindented). rifty
 * prints none on any host (ADR-0445 2026-11-22): JS cannot read V8's message
 * location, so a printed one could only be inferred.
 */
export const NODE_HEADER = /^\S+:\d+$/mu;

/** One row's assertion against its pin; `assert` is vitest's or playwright's (soft) expect. */
export function nodeFileVerdict(
  assert: (actual: unknown, message?: string) => Expectation,
  host: NodeFileHost,
  row: {
    readonly program: NodeFileProgram;
    readonly expected: NodeFileOutcome;
    readonly actual: NodeFileOutcome;
  },
): void {
  const label = `${host} ${row.program.name}`;
  const pin = nodeFilePins[host][row.program.name];
  if (pin === undefined) throw new Error(`${label}: no pin in node-file-pins.json`);
  assert(NODE_HEADER.exec(row.actual.stderr)?.[0] ?? null, `${label}: no Node header`).toEqual(
    null,
  );
  if (pin === 'node') {
    assert(row.actual, `${label} vs Node`).toEqual(row.expected);
    return;
  }
  const racy = nodeFileRacy[row.program.name];
  if (racy !== undefined) {
    assert({ ...row.actual, stdout: '' }, `${label} vs its pin`).toEqual({ ...pin, stdout: '' });
    assert([pin.stdout, `${pin.stdout}${racy}`], label).toContain(row.actual.stdout);
    return;
  }
  assert(row.actual, `${label} vs its pin (a change: read the diff, then move the pin)`).toEqual(
    pin,
  );
  assert(row.actual, `${label}: pinned row equals Node — pin it "node"`).not.toEqual(row.expected);
}

/** Dev aid: `NODE_FILE_DUMP=<dir>` writes each host's rows for diffing. */
export function nodeFileDump(host: NodeFileHost, rows: unknown): void {
  const dir = process.env.NODE_FILE_DUMP;
  if (dir !== undefined)
    writeFileSync(join(dir, `node-file-${host}.json`), JSON.stringify(rows, null, 2));
}
