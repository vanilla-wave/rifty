import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion, transform } from 'esbuild';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('undici/package.json'));
const version = require('undici/package.json').version;
const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: generate-fetch-classes.mjs --write|--check');
}
if (version !== '7.25.0' || esbuildVersion !== '0.28.0') {
  throw new Error('Fetch source/tool version drift: re-probe ADR-0541');
}
const sources = new Map();
function replace(source, before, after, path) {
  if (source.split(before).length !== 2)
    throw new Error(`Fetch port anchor drift: ${path}: ${before}`);
  return source.replace(before, after);
}
const result = await build({
  stdin: {
    contents: `module.exports = {
      ...require('./lib/web/fetch/response'),
      ...require('./lib/web/fetch/request'),
      ...require('./lib/web/fetch/headers'),
      ...require('./lib/web/fetch/formdata'),
      fullyReadBody: require('./lib/web/fetch/util').fullyReadBody,
      argumentLengthCheck: require('./lib/web/webidl').webidl.argumentLengthCheck
    };`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  keepNames: true,
  plugins: [
    {
      name: 'node-fetch-platform-bindings',
      setup(plugin) {
        plugin.onLoad({ filter: /\.js$/ }, async ({ path }) => {
          const name = relative(root, path).replaceAll('\\', '/');
          let source = await readFile(path, 'utf8');
          sources.set(name, createHash('sha256').update(source).digest('hex'));
          const edit = (before, after) => {
            source = replace(source, before, after, name);
          };
          if (name === 'lib/core/util.js') {
            // These socket helpers are outside the class graph's executed path.
            // Resolve their real builtin only if called; class installation needs no net registration.
            edit("const { IncomingMessage } = require('node:http')", '');
            edit("const net = require('node:net')", '');
            edit('net.isIP(servername)', "require('node:net').isIP(servername)");
            edit('=== IncomingMessage', "=== require('node:http').IncomingMessage");
            edit('stream.isDisturbed(body)', '__riftyFetchPlatform.isDisturbed(body)');
          }
          if (name === 'lib/web/webidl/index.js') {
            edit('types.isProxy(O)', '__riftyFetchPlatform.isProxy(O)');
            edit('value.isWellFormed()', '__riftyFetchPlatform.isUSVString(value)');
            edit('value.toWellFormed()', '__riftyFetchPlatform.toUSVString(value)');
            edit('`${value}`.toWellFormed()', '__riftyFetchPlatform.toUSVString(`${value}`)');
          }
          if (name === 'lib/web/fetch/headers.js') {
            edit('util.types.isProxy(V)', '__riftyFetchPlatform.isProxy(V)');
          }
          if (name === 'lib/web/fetch/body.js') {
            // Native cancel disturbs even errored streams; inspect native state
            // before finalization instead of approximating Node isErrored.
            edit(
              '!isDisturbed(stream) && !isErrored(stream)',
              '!__riftyFetchPlatform.isDisturbed(stream)',
            );
            edit(
              "stream.cancel('Response object has been garbage collected').catch(noop)",
              "__riftyFetchPlatform.finalizeBody(stream, 'Response object has been garbage collected')",
            );
            edit(
              'assert(webidl.is.ReadableStream(stream))',
              'assert(webidl.is.ReadableStream(stream)); __riftyFetchPlatform.trackBody(stream)',
            );
            // Here the module owns the byte controller: desiredSize=null is its
            // exact native errored state, with no emulated stream-state ledger.
            edit('if (isErrored(stream)) break', 'if (controller.desiredSize === null) break');
            edit('!isErrored(stream)', 'controller.desiredSize !== null');
            edit(
              'body.stream = out1',
              '__riftyFetchPlatform.trackBody(out1); __riftyFetchPlatform.trackBody(out2); body.stream = out1',
            );
          }
          if (name === 'lib/web/fetch/request.js') {
            edit('process.emitWarning(', '__riftyFetchPlatform.emitWarning(');
            edit(
              'this.#state.body = finalBody',
              'if (finalBody) __riftyFetchPlatform.trackBody(finalBody.stream); this.#state.body = finalBody',
            );
          }
          return { contents: source, loader: 'js' };
        });
      },
    },
  ],
});
const provenance = [...sources].sort(([a], [b]) => a.localeCompare(b));
const sha = createHash('sha256').update(JSON.stringify(provenance)).digest('hex');
const compiled = await transform(
  `export default function createFetchClasses(require, process, Buffer, __riftyFetchPlatform) {
const module = {exports:{}};
${result.outputFiles[0].text}
return module.exports;
}`,
  { format: 'esm', target: 'es2022', minify: true, keepNames: true, legalComments: 'eof' },
);
const output = `// Generated by tools/publishing/generate-fetch-classes.mjs; do not edit.\n// undici ${version}, source graph sha256 ${sha}; esbuild ${esbuildVersion}. ADR-0541.\n${compiled.code}`;
const directory = fileURLToPath(
  new URL('../../packages/runtime-js/src/builtins/fetch/generated/', import.meta.url),
);
const files = {
  'classes.js': output,
  'undici.LICENSE': await readFile(join(root, 'LICENSE'), 'utf8'),
  'sources.json': `${JSON.stringify({ version, esbuild: esbuildVersion, sha256: sha, sources: Object.fromEntries(provenance) }, null, 2)}\n`,
};
for (const [name, bytes] of Object.entries(files)) {
  if (mode === '--write') {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), bytes);
  } else if ((await readFile(join(directory, name), 'utf8')) !== bytes) {
    throw new Error(`Fetch classes drift: ${name}; run pnpm fetch-classes:generate`);
  }
}
console.log(`fetch-classes ${mode}: undici ${version}, ${Buffer.byteLength(output)} bytes, ${sha}`);

// Function#toString depends on the host transpiler (tsx injects __name).
// Compile the same closed bootstrap ahead of time, including its helpers.
const proxySourceUrl = new URL(
  '../../packages/runtime-js/src/internal/proxy-identity.ts',
  import.meta.url,
);
const proxySource = await readFile(proxySourceUrl, 'utf8');
const ast = ts.createSourceFile('proxy-identity.ts', proxySource, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(
  (statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'createProxyIdentity',
);
if (declaration === undefined) throw new Error('Missing Proxy identity bootstrap');
const functionSource = declaration.getText(ast).replace(/^export\s+/u, '');
const bootstrap = await transform(`(${functionSource})().isProxy`, {
  loader: 'ts',
  target: 'es2022',
  minify: true,
  keepNames: false,
});
const expression = ts.createSourceFile(
  'bootstrap.js',
  bootstrap.code,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
if (expression.statements.length !== 1 || !ts.isExpressionStatement(expression.statements[0]))
  throw new Error('Proxy bootstrap is not a closed expression');
const proxyHash = createHash('sha256').update(proxySource).digest('hex');
const proxyOutput = `// Generated by tools/publishing/generate-fetch-classes.mjs; source sha256 ${proxyHash}.\nexport default ${JSON.stringify(bootstrap.code)};\n`;
const proxyOutputUrl = new URL(
  '../../packages/runtime-js/src/internal/generated/proxy-identity.js',
  import.meta.url,
);
if (mode === '--write') {
  await mkdir(dirname(fileURLToPath(proxyOutputUrl)), { recursive: true });
  await writeFile(proxyOutputUrl, proxyOutput);
} else if ((await readFile(proxyOutputUrl, 'utf8')) !== proxyOutput)
  throw new Error('Proxy bootstrap drift: run pnpm fetch-classes:generate');
