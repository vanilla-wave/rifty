import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
    name: 'syntax-error-entry',
    files: { 'main.js': 'const a = 1;\nlet x = ;\n' },
    argv: ['main.js'],
  },
  {
    name: 'syntax-error-dependency',
    files: { 'main.js': "require('./lib/broken');\n", 'lib/broken.js': 'function (\n' },
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
    const internal = /^\s+at (?:async )?(?:.* \()?node:[^)\s]*\)?( \{)?$/u.exec(line);
    if (internal === null) kept.push(line);
    // inspect opens the props block on the last frame line: it moves up a line.
    else if (internal[1] !== undefined) kept.push(`${kept.pop() ?? ''} {`);
  }
  const stderr = kept.join('\n').replace(/^Node\.js v\d+\.\d+\.\d+$/mu, `Node.js ${riftyVersion}`);
  return nodeFileNormalized({ ...oracle, stderr }, oracle.root);
}

export function nodeFileNormalized(outcome: NodeFileOutcome, root: string): NodeFileOutcome {
  const paths = (text: string) => text.split(root).join('<root>');
  return {
    stdout: paths(outcome.stdout),
    stderr: paths(outcome.stderr),
    exitCode: outcome.exitCode,
  };
}

export type NodeFileHost = 'no-COI' | 'COI';

/**
 * Expected-failure rows: a row listed for a host is not at Node parity yet and
 * must still differ (a fix that lands makes it fail until removed here); every
 * other row must equal Node. Shrinks to empty as the goal's map lands.
 */
const LANDED = new Set<string>();
const OPEN = [...entryPrograms, ...fatalPrograms]
  .map((program) => program.name)
  .filter((name) => !LANDED.has(name));
export const nodeFileOpenRows: Readonly<Record<NodeFileHost, ReadonlySet<string>>> = {
  'no-COI': new Set(OPEN),
  COI: new Set(OPEN),
};

interface SoftExpect {
  soft(
    actual: unknown,
    message?: string,
  ): {
    toEqual(expected: unknown): void;
    not: { toEqual(expected: unknown): void };
  };
}

export function nodeFileVerdict(
  expect: SoftExpect,
  host: NodeFileHost,
  row: {
    readonly program: NodeFileProgram;
    readonly expected: NodeFileOutcome;
    readonly actual: NodeFileOutcome;
  },
): void {
  const label = `${host} ${row.program.name}`;
  if (nodeFileOpenRows[host].has(row.program.name)) {
    expect
      .soft(row.actual, `${label}: open row now equals Node — remove it from nodeFileOpenRows`)
      .not.toEqual(row.expected);
  } else {
    expect.soft(row.actual, `${label} vs Node`).toEqual(row.expected);
  }
}

/** Dev aid: `NODE_FILE_DUMP=<dir>` writes each host's rows for diffing. */
export function nodeFileDump(host: NodeFileHost, rows: unknown): void {
  const dir = process.env.NODE_FILE_DUMP;
  if (dir !== undefined)
    writeFileSync(join(dir, `node-file-${host}.json`), JSON.stringify(rows, null, 2));
}
