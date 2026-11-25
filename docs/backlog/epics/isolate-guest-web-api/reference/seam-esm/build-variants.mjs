// Variant guest bundles for the seam/ESM probe (not a carrier, not shipped).
// Same esbuild config as packages/isolate-guest/scripts/build-guest.mjs, plus an onLoad
// plugin per variant. Each variant = a copy of packages/isolate-host/dist with guest.js replaced,
// under packages/isolate-host/node_modules/.web-api-probe/<variant>/dist/ (gitignored; isolated-vm
// resolves from there).
//   node docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/build-variants.mjs
// Variants:
//   url-first      core-js 3.51.0 URL/URLSearchParams installed right after web-shim.ts (before
//                  every runtime module); both names out of CEILING_GLOBALS
//   url-esm        url-first + entry.ts's `declareNoEsmLoader(esmGap)` removed
//   trace-load     base guest; every CEILING_GLOBALS name (and crypto.subtle) is a logging getter
//                  returning undefined until setUp() installs the ceilings: guest code reads the
//                  log from globalThis.__probeLoadReads (stacks; guest.js.map beside guest.js)
//   ceilings-first base guest, but installCeilingGlobals() also runs at the end of web-shim.ts
//                  (before every runtime module); setUp() installs them again. DEFER names are
//                  removed again right after the early call (env-free knob: edit DEFER below)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const guestPkg = join(root, 'packages/isolate-guest');
const hostPkg = join(root, 'packages/isolate-host');
const out = join(hostPkg, 'node_modules/.web-api-probe');
const { build } = createRequire(join(guestPkg, 'package.json'))('esbuild');
const coreJs = join(hostPkg, 'node_modules/core-js');

const SHIM = /src\/guest\/web-shim\.ts$/;
const ENTRY = /src\/guest\/entry\.ts$/;
const mustReplace = (src, from, to, what) => {
  if (!src.includes(from)) throw new Error(`anchor missing: ${what}`);
  return src.replace(from, to);
};

const VARIANTS = {
  'url-first': { url: true },
  'url-esm': { url: true, esm: true },
  'trace-load': { traceLoad: true },
  'ceilings-first': { ceilingsFirst: true },
  'ceilings-first-ports-late': {
    ceilingsFirst: true,
    defer: ['MessageChannel', 'MessagePort', 'BroadcastChannel'],
  },
  'ceilings-first-ports-subtle-late': {
    ceilingsFirst: true,
    defer: ['MessageChannel', 'MessagePort', 'BroadcastChannel', 'crypto.subtle'],
  },
};

mkdirSync(out, { recursive: true });
const injectUrl = join(out, 'inject-url.js');
writeFileSync(
  injectUrl,
  `require(${JSON.stringify(join(coreJs, 'actual/url'))});\nrequire(${JSON.stringify(join(coreJs, 'actual/url-search-params'))});\n`,
);

for (const [name, v] of Object.entries(VARIANTS)) {
  const plugin = {
    name: 'probe-variant',
    setup(b) {
      b.onLoad({ filter: SHIM }, (args) => {
        let src = readFileSync(args.path, 'utf8');
        if (v.url)
          src = mustReplace(src, "  'URL',\n  'URLSearchParams',\n", '', 'CEILING_GLOBALS URL');
        if (v.traceLoad)
          src += `
{
  const reads = [];
  Object.defineProperty(g, '__probeLoadReads', { value: reads });
  const log = (name) => { const l = Error.stackTraceLimit; Error.stackTraceLimit = 50; reads.push({ name, stack: new Error().stack }); Error.stackTraceLimit = l; };
  for (const name of CEILING_GLOBALS) Object.defineProperty(g, name, { get() { log(name); return undefined; }, configurable: true });
  Object.defineProperty(crypto, 'subtle', { get() { log('crypto.subtle'); return undefined; }, configurable: true });
}
`;
        if (v.ceilingsFirst)
          src += `\ninstallCeilingGlobals();\nfor (const n of ${JSON.stringify(v.defer ?? [])}) { const [a, b] = n.split('.'); if (b) delete g[a][b]; else delete g[a]; }\n`;
        return { contents: src, loader: 'ts' };
      });
      b.onLoad({ filter: ENTRY }, (args) => {
        let src = readFileSync(args.path, 'utf8');
        if (v.esm) src = mustReplace(src, 'declareNoEsmLoader(esmGap);', '', 'declareNoEsmLoader');
        return { contents: src, loader: 'ts' };
      });
    },
  };
  const dir = join(out, name, 'dist');
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(hostPkg, 'dist'), dir, { recursive: true });
  await build({
    absWorkingDir: guestPkg,
    entryPoints: ['src/guest/entry.ts'],
    inject: ['src/guest/web-shim.ts', ...(v.url ? [injectUrl] : [])],
    outfile: join(dir, 'guest.js'),
    bundle: true,
    target: 'es2022',
    logLevel: 'warning',
    legalComments: 'none',
    platform: 'browser',
    format: 'iife',
    external: ['node:module'],
    plugins: [plugin],
    sourcemap: Boolean(v.traceLoad),
  });
  const size = readFileSync(join(dir, 'guest.js')).length;
  console.log(`${name}: ${dir}/guest.js ${size} bytes`);
}
console.log(
  `base: ${join(hostPkg, 'dist/guest.js')} ${readFileSync(join(hostPkg, 'dist/guest.js')).length} bytes`,
);
