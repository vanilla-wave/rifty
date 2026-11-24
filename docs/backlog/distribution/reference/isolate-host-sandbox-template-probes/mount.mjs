#!/usr/bin/env node
/**
 * Template probe M — where a template's `node_modules` can be mounted so that
 * `require('<lib>')` from `/workspace/main.js` resolves into it. Same trees in a
 * rifty sandbox (built `@riftydev/isolate-host`, host writeFile at absolute
 * paths) and in real Node over a temp dir (its path read as `/`).
 *
 *   pnpm --filter @riftydev/isolate-guest build && pnpm --filter @riftydev/isolate-host build
 *   node docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/mount.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const { createSandbox } = await import(join(repo, 'packages/isolate-host/dist/index.js'));

const MAIN = `
const fs = require('fs');
const out = {};
for (const id of ['lib', 'deep', 'exp', 'exp/sub', 'missing']) {
  try { out[id] = { resolve: require.resolve(id), value: require(id) }; }
  catch (e) { out[id] = { code: e.code, message: e.message.split('\\n')[0] }; }
}
out.paths = module.paths;
out.exists = ['../node_modules/lib/index.js', 'node_modules/lib/index.js'].map((p) => fs.existsSync(p));
out.readdirRoot = fs.readdirSync('/').sort();
console.log(JSON.stringify(out));
`;

const lib = (root) => ({
  [`${root}/lib/package.json`]: JSON.stringify({ name: 'lib', main: 'main.js' }),
  [`${root}/lib/main.js`]: "module.exports = 'lib@' + __dirname + ' dep=' + require('dep');",
  [`${root}/lib/index.js`]: "module.exports = 'wrong: index.js';",
  // Hoisted dependency of `lib`, as npm lays it out.
  [`${root}/dep/index.js`]: "module.exports = 'dep@' + __dirname;",
  // A nested copy shadowing a hoisted one.
  [`${root}/deep/index.js`]: "module.exports = require('dep');",
  [`${root}/deep/node_modules/dep/index.js`]: "module.exports = 'nested-dep@' + __dirname;",
  // `exports` map with a subpath.
  [`${root}/exp/package.json`]: JSON.stringify({
    name: 'exp',
    exports: { '.': { require: './cjs.js', default: './esm.mjs' }, './sub': './sub.js' },
  }),
  [`${root}/exp/cjs.js`]: "module.exports = 'exp-cjs';",
  [`${root}/exp/sub.js`]: "module.exports = 'exp-sub';",
});

const layouts = {
  '/node_modules': lib('/node_modules'),
  '/workspace/node_modules': lib('/workspace/node_modules'),
};

async function rifty(files) {
  const sb = await createSandbox();
  for (const [p, c] of Object.entries(files)) await sb.writeFile(p, c);
  await sb.writeFile('/workspace/main.js', MAIN);
  const r = await sb.exec('main.js');
  await sb.destroy();
  return r;
}

function node(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tpl-mount-')));
  try {
    for (const [p, c] of Object.entries({ ...files, '/workspace/main.js': MAIN })) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    const stdout = execFileSync(process.execPath, ['main.js'], {
      cwd: join(root, 'workspace'),
      encoding: 'utf8',
    });
    // The temp dir read as `/`; its own ancestors' node_modules dropped from module.paths.
    const out = JSON.parse(stdout.split(root).join(''));
    out.paths = out.paths.slice(0, 2);
    out.readdirRoot = '(host /, not compared)';
    return { out, root };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, files] of Object.entries(layouts)) {
  const r = await rifty(files);
  const n = node(files);
  const ro = r.exitCode === 0 ? JSON.parse(r.stdout) : r;
  if (ro.paths) ro.paths = ro.paths.filter((p) => p.startsWith('/'));
  console.log(`\n## ${name}`);
  console.log('rifty exit', r.exitCode, r.stderr.slice(0, 300));
  console.log('rifty', JSON.stringify(ro, null, 1));
  console.log('node ', JSON.stringify({ ...n.out, readdirRoot: undefined }, null, 1));
  const strip = (o) => JSON.stringify({ ...o, readdirRoot: undefined, paths: undefined });
  console.log('same (except module.paths, readdir /):', strip(ro) === strip(n.out));
  console.log(
    'module.paths rifty:',
    JSON.stringify(ro.paths),
    ' node (temp-root-relative):',
    JSON.stringify(n.out.paths),
  );
}
process.exit(0);
