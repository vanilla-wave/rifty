/**
 * Shared program files for the `execArgv` startup-option cases (ADR-0449):
 * `-r`/`--require` preloads, `-C`/`--conditions` and
 * `--experimental-import-meta-resolve` on `fork` and `worker_threads.Worker`.
 * One source runs in real Node, in the parity runner's rifty and, through
 * `tests/browser-unit/worker-stdio-exec-argv.spec.ts`, in rifty under Chromium.
 * Keys are relative to the program root (the parent's cwd); a parity case
 * prefixes them with its own cwd directory.
 *
 * Probes report through `parentPort` (a Worker) or `process.send` (a fork), so
 * the startup facts never depend on the Worker stdout surface.
 */

/** vitest 4.1.11 `suppress-warnings.cjs`, verbatim (MIT) — its pools preload it. */
export const VITEST_SUPPRESS_WARNINGS_SOURCE = `// borrowed from tsx implementation:
// https://github.com/esbuild-kit/tsx

const ignoreWarnings = new Set([
  '--experimental-loader is an experimental feature. This feature could change at any time',
  'Custom ESM Loaders is an experimental feature. This feature could change at any time',
  'Custom ESM Loaders is an experimental feature and might change at any time',
  'VM Modules is an experimental feature and might change at any time',
  'VM Modules is an experimental feature. This feature could change at any time',
  'stripTypeScriptTypes is an experimental feature and might change at any time',
])

const { emit } = process

process.emit = function (event, warning) {
  if (event === 'warning' && ignoreWarnings.has(warning.message)) {
    return
  }

  // eslint-disable-next-line prefer-rest-params
  return Reflect.apply(emit, this, arguments)
}
`;

const REPORT = `const report = (facts) => {
  const { parentPort } = require('node:worker_threads');
  if (parentPort) parentPort.postMessage(facts);
  else process.send(facts);
};
`;

const WARNINGS = `const warnings = [];
process.on('warning', (warning) => warnings.push(warning.message));
process.emit('warning', new Error('VM Modules is an experimental feature and might change at any time'));
process.emit('warning', new Error('other warning'));
`;

export const STARTUP_FILES: Readonly<Record<string, string>> = {
  'pre.cjs': `globalThis.__pre = (globalThis.__pre || []).concat('pre');
globalThis.__preFacts = {
  requireMain: String(require.main),
  execArgv: process.execArgv.slice(),
  cpkg: require('cpkg'),
};
`,
  'pre2.cjs': "globalThis.__pre = (globalThis.__pre || []).concat('pre2');\n",
  'sub/pre.cjs': "globalThis.__pre = (globalThis.__pre || []).concat('pre-sub');\n",
  'suppress-warnings.cjs': VITEST_SUPPRESS_WARNINGS_SOURCE,
  'a.mjs': "export default 'root-a';\n",
  'sub/a.mjs': "export default 'sub-a';\n",
  'sub/node_modules/lpkg/package.json': '{"name":"lpkg","main":"index.js"}\n',
  'sub/node_modules/lpkg/index.js': "module.exports = 'lpkg';\n",
  'node_modules/cpkg/package.json': `${JSON.stringify({
    name: 'cpkg',
    exports: {
      '.': {
        custom: './custom.js',
        development: './dev.js',
        import: './imp.mjs',
        require: './req.js',
        default: './def.js',
      },
      './sub': { custom: './custom-sub.js', default: './def-sub.js' },
    },
  })}\n`,
  'node_modules/cpkg/custom.js': "module.exports = 'custom';\n",
  'node_modules/cpkg/dev.js': "module.exports = 'dev';\n",
  'node_modules/cpkg/req.js': "module.exports = 'req';\n",
  'node_modules/cpkg/def.js': "module.exports = 'def';\n",
  'node_modules/cpkg/imp.mjs': "export default 'imp';\n",
  'node_modules/cpkg/custom-sub.js': "module.exports = 'custom-sub';\n",
  'node_modules/cpkg/def-sub.js': "module.exports = 'def-sub';\n",
  'node_modules/ipkg/package.json': `${JSON.stringify({
    name: 'ipkg',
    imports: { '#dep': { custom: './i-custom.js', default: './i-def.js' } },
    exports: './main.js',
  })}\n`,
  'node_modules/ipkg/main.js': "module.exports = require('#dep');\n",
  'node_modules/ipkg/i-custom.js': "module.exports = 'i-custom';\n",
  'node_modules/ipkg/i-def.js': "module.exports = 'i-def';\n",
  // CommonJS probe: require, require.resolve, package imports, dynamic import.
  'probe.cjs': `${REPORT}${WARNINGS}const path = require('node:path');
const facts = {
  execArgv: process.execArgv,
  pre: globalThis.__pre ?? null,
  preFacts: globalThis.__preFacts ?? null,
  require: require('cpkg'),
  requireResolve: path.relative(__dirname, require.resolve('cpkg/sub')),
  imports: require('ipkg'),
  warnings,
};
import('cpkg').then((namespace) => {
  facts.dynamicImport = namespace.default;
  report(facts);
});
`,
  // ESM probe: static/dynamic import and import.meta.resolve with and without a parent.
  'probe.mjs': `import { createRequire } from 'node:module';
import cpkg from 'cpkg';
import cpkgSub from 'cpkg/sub';
const require = createRequire(import.meta.url);
${REPORT}${WARNINGS}const root = new URL('./', import.meta.url).href;
const rel = (url) => (typeof url === 'string' && url.startsWith(root) ? url.slice(root.length) : url);
const attempt = (resolve) => {
  try {
    return rel(resolve());
  } catch (error) {
    return error.name + ':' + error.code;
  }
};
const parent = new URL('./sub/x.mjs', import.meta.url);
const flagged = process.execArgv.includes('--experimental-import-meta-resolve');
const namespace = await import('cpkg');
report({
  execArgv: process.execArgv,
  pre: globalThis.__pre ?? null,
  preFacts: globalThis.__preFacts ?? null,
  static: cpkg,
  staticSub: cpkgSub,
  dynamicImport: namespace.default,
  metaBare: attempt(() => import.meta.resolve('cpkg')),
  metaParent: attempt(() => import.meta.resolve('./a.mjs', parent.href)),
  metaParentUrl: attempt(() => import.meta.resolve('./a.mjs', parent)),
  metaParentInvalid: attempt(() => import.meta.resolve('./a.mjs', 'not a url')),
  ...(flagged ? { metaParentBare: attempt(() => import.meta.resolve('lpkg', parent.href)) } : {}),
  warnings,
});
`,
  // vitest's pool entry: its output travels through the piped stdout, not IPC.
  'pool-probe.mjs': `import cpkg from 'cpkg';
${WARNINGS}const shown = process.execArgv.map((arg) =>
  arg.startsWith('/') ? '<abs>/' + arg.slice(arg.lastIndexOf('/') + 1) : arg,
);
const parent = new URL('./sub/x.mjs', import.meta.url);
const root = new URL('./', import.meta.url).href;
const meta = import.meta.resolve('./a.mjs', parent.href).slice(root.length);
process.stdout.write('pool execArgv ' + JSON.stringify(shown) + '\\n');
process.stdout.write('pool cpkg ' + cpkg + ' meta ' + meta + '\\n');
process.stdout.write('pool warnings ' + JSON.stringify(warnings) + '\\n');
process.stderr.write('stderr of the pool entry\\n');
`,
};

/** `STARTUP_FILES` rooted under `dir` (a parity case's cwd directory). */
export function startupFilesUnder(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [key, value] of Object.entries(STARTUP_FILES)) files[`${dir}/${key}`] = value;
  return files;
}

/** vitest 4.1.11 pool `execArgv` (cli-api resolveOptions + resolveConditions) for vite 8.0.16. */
export const VITEST_POOL_EXEC_ARGV_SOURCE = `[
  '--experimental-import-meta-resolve',
  '--require',
  require('node:path').resolve('suppress-warnings.cjs'),
  '--conditions',
  'node',
  '--conditions',
  'development',
]`;
