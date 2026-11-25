// ADR-0573: Node v24.16.0 deps/zlib (Chromium fork) → zlib.wasm by a pinned wasi-sdk → runtime-js
// `zlib-engine/generated/`, plus the Node test inputs the engine's tests read. Pins (URL + sha256)
// live in generated/sources.json; every download is checked before it is unpacked.
//   --write    fetch, build, write generated/ + the test fixtures
//   --check    no toolchain: committed module, licence and fixtures match sources.json
//   --rebuild  fetch, build in a temp dir, require byte equality with the committed files
// Optional `--cache DIR` (default ~/.cache/rifty-zlib-wasm) keeps the verified downloads.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const mode = args[0];
const cacheAt = args.indexOf('--cache');
const cache = cacheAt === -1 ? join(homedir(), '.cache/rifty-zlib-wasm') : args[cacheAt + 1];
if (!['--write', '--check', '--rebuild'].includes(mode) || args.length !== (cacheAt === -1 ? 1 : 3))
  throw new Error('Usage: generate-zlib-wasm.mjs --write|--check|--rebuild [--cache DIR]');

const repo = fileURLToPath(new URL('../../', import.meta.url));
const GEN = join(repo, 'packages/runtime-js/src/zlib-engine/generated');
const FIX = join(repo, 'packages/runtime-js/tests/fixtures/zlib-engine/node');
const pins = JSON.parse(await readFile(join(GEN, 'sources.json'), 'utf8'));
const NODE_DIR = `node-${pins.node.version}`;

// Node's own non-SIMD branch of deps/zlib/zlib.gyp; no contrib/optimizations/inflate.c. Do not
// define CHROMIUM_ZLIB_NO_CASTAGNOLI: the fork then hashes like vanilla zlib and bytes differ.
const SOURCES = [
  'adler32.c',
  'crc32.c',
  'deflate.c',
  'inflate.c',
  'inftrees.c',
  'inffast.c',
  'trees.c',
  'zutil.c',
  'cpu_features.c',
];
const EXPORTS = [
  'deflateInit2_',
  'inflateInit2_',
  'deflate',
  'inflate',
  'deflateEnd',
  'inflateEnd',
  'deflateReset',
  'inflateReset',
  'deflateParams',
  'deflateSetDictionary',
  'inflateSetDictionary',
  'crc32',
  'zlibVersion',
  'malloc',
  'free',
];
const FLAGS = [
  '--target=wasm32-wasip1',
  '-mexec-model=reactor',
  '-O2',
  '-DCPU_NO_SIMD',
  '-DHAVE_HIDDEN',
  '-Wno-implicit-fallthrough',
  '-Wno-deprecated-non-prototype',
  '-I.',
];
// --strip-debug, not --strip-all: wasm-opt reads the enabled features from target_features.
const LINK = ['-Wl,--no-entry', '-Wl,--strip-debug', ...EXPORTS.map((e) => `-Wl,--export=${e}`)];
/** binaryen (its JS/wasm build: one binary on every host), an explicit step after the link. */
const WASM_OPT = ['-O3', '--strip-debug', '--strip-producers', '--strip-target-features'];
/** Node test inputs the engine's tests read (Acceptance 1 corpus, 2 suite + lib/zlib.js). */
const FIXTURE_FILES = (suite) => [
  'LICENSE',
  'lib/zlib.js',
  'deps/zlib/deflate.c',
  'deps/zlib/inflate.c',
  'deps/zlib/trees.c',
  ...[
    'person.jpg',
    'person.jpg.gz',
    'pseudo-multimember-gzip.gz',
    'pseudo-multimember-gzip.z',
    'elipses.txt',
    'empty.txt',
  ].map((f) => `test/fixtures/${f}`),
  // test/common as the deflate-family files load it (index → tmpdir; fixtures; gc).
  ...['package.json', 'index.js', 'tmpdir.js', 'fixtures.js', 'gc.js'].map(
    (f) => `test/common/${f}`,
  ),
  ...suite.map((f) => `test/parallel/${f}`),
];
// Chromium's LICENSE (chromium/src LICENSE, BSD-3): cpu_features.c and insert_string.h point at it
// and the Node tarball does not carry it.
const CHROMIUM_LICENSE = `Copyright 2015 The Chromium Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'pipe', ...opts });

function fileSha(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej);
  });
}

/** Download once into the cache; the sha256 is checked before anything reads the file. */
async function fetchPinned({ url, sha256: want }) {
  const name = url.slice(url.lastIndexOf('/') + 1);
  const file = join(cache, 'dl', `${want}-${name}`);
  if (!existsSync(file)) {
    await mkdir(dirname(file), { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`zlib-wasm: ${url} → HTTP ${res.status}`);
    const part = `${file}.part`;
    await writeFile(part, Buffer.from(await res.arrayBuffer()));
    await rename(part, file);
  }
  const got = await fileSha(file);
  if (got !== want) {
    await rm(file, { force: true });
    throw new Error(`zlib-wasm: ${name} sha256 ${got}, pinned ${want}`);
  }
  return file;
}

async function unpackOnce(tarball, sha, members) {
  const dir = join(cache, 'x', sha);
  if (!existsSync(join(dir, '.done'))) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    sh('tar', ['xf', tarball, '-C', dir, ...members]);
    await writeFile(join(dir, '.done'), '');
  }
  return dir;
}

/** wasi-sdk's VERSION file → one line (release, llvm, wasi-libc commits). */
function describe(text) {
  const [release, ...rest] = text.trim().split('\n');
  const f = Object.fromEntries(rest.map((l) => l.split(': ')));
  return `wasi-sdk ${release} (llvm ${f['llvm-version']} ${f.llvm}, wasi-libc ${f['wasi-libc']})`;
}

async function toolchain() {
  const host = `${process.platform}-${process.arch}`;
  const pin = pins.toolchain.hosts[host];
  if (!pin) throw new Error(`zlib-wasm: no pinned ${pins.toolchain.release} for ${host}`);
  const dir = await unpackOnce(await fetchPinned(pin), pin.sha256, []);
  const [root] = (await readdir(dir)).filter((n) => n.startsWith('wasi-sdk-'));
  return {
    clang: join(dir, root, 'bin/clang'),
    sysroot: join(dir, root, 'share/wasi-sysroot'),
    version: describe(await readFile(join(dir, root, 'VERSION'), 'utf8')),
  };
}

async function binaryen() {
  const dir = await unpackOnce(await fetchPinned(pins.binaryen), pins.binaryen.sha256, []);
  const wasmOpt = join(dir, `binaryen-${pins.binaryen.release}`, 'wasm-opt.js');
  const version = sh(process.execPath, [wasmOpt, '--version'], { env: {} }).toString().trim();
  return { wasmOpt, version };
}

async function nodeSource() {
  const tarball = await fetchPinned(pins.node);
  const dir = await unpackOnce(
    tarball,
    pins.node.sha256,
    ['LICENSE', 'lib/zlib.js', 'deps/zlib', 'test/common', 'test/fixtures', 'test/parallel'].map(
      (m) => `${NODE_DIR}/${m}`,
    ),
  );
  return join(dir, NODE_DIR);
}

/**
 * Compile in a fresh directory with relative paths and an empty environment: no host path, include
 * variable, or a `wasm-opt` on PATH (clang runs one when it finds it) can reach the output; the
 * pinned wasm-opt then runs as its own step.
 */
async function build(node, tc, opt) {
  const work = await mkdtemp(join(tmpdir(), 'zlib-wasm-'));
  try {
    const z = join(node, 'deps/zlib');
    for (const f of await readdir(z))
      if (/\.[ch]$/.test(f)) await copyFile(join(z, f), join(work, f));
    await mkdir(join(work, 'contrib/optimizations'), { recursive: true });
    for (const f of await readdir(join(z, 'contrib/optimizations')))
      if (f.endsWith('.h'))
        await copyFile(join(z, 'contrib/optimizations', f), join(work, 'contrib/optimizations', f));
    sh(tc.clang, [`--sysroot=${tc.sysroot}`, ...FLAGS, ...SOURCES, ...LINK, '-o', 'linked.wasm'], {
      cwd: work,
      env: { PATH: dirname(tc.clang) },
    });
    sh(process.execPath, [opt.wasmOpt, ...WASM_OPT, 'linked.wasm', '-o', 'zlib.wasm'], {
      cwd: work,
      env: {},
    });
    return await readFile(join(work, 'zlib.wasm'));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Node's deflate-family tests: brotli and zstd are out of scope (ADR-0573 §7). */
async function suiteFiles(node) {
  return (await readdir(join(node, 'test/parallel')))
    .filter((f) => /^test-zlib.*\.js$/.test(f) && !/brotli|zstd/.test(f))
    .sort();
}

function licence(nodeLicense) {
  const zlib = nodeLicense.match(
    /^- zlib, located at deps\/zlib, is licensed as follows:\n {2}"""[\s\S]*?\n {2}"""$/m,
  );
  if (!zlib) throw new Error('zlib-wasm: Node LICENSE has no deps/zlib section');
  const node = nodeLicense.slice(
    0,
    nodeLicense.indexOf('The Node.js license applies to all parts'),
  );
  return [
    'zlib.wasm: Node.js deps/zlib (Chromium zlib fork), built by tools/publishing/generate-zlib-wasm.mjs.',
    '',
    zlib[0],
    '',
    '- Chromium additions in deps/zlib (cpu_features.c, contrib/optimizations/insert_string.h):',
    CHROMIUM_LICENSE,
    'The handle port (zlib-engine/*.ts) ports Node.js src/node_zlib.cc:',
    '',
    node.trimEnd(),
    '',
  ].join('\n');
}

function moduleText(wasm, meta) {
  return `// Generated by tools/publishing/generate-zlib-wasm.mjs; do not edit. ADR-0573.
// Node ${meta.node} deps/zlib → wasm32 reactor, ${meta.toolchain}; ${wasm.length} bytes, sha256 ${meta.sha256}. Zlib + BSD-3: LICENSE.
export const ZLIB_WASM_SHA256 = '${meta.sha256}';
export const ZLIB_WASM_BASE64 =
  '${wasm.toString('base64')}';
`;
}
const DTS = `// Generated by tools/publishing/generate-zlib-wasm.mjs; do not edit.
export declare const ZLIB_WASM_SHA256: string;
export declare const ZLIB_WASM_BASE64: string;
`;

/** Every output file, keyed by repo-relative path. */
async function render() {
  const [tc, opt, node] = [await toolchain(), await binaryen(), await nodeSource()];
  const wasm = await build(node, tc, opt);
  const toolchainText = `${tc.version} + ${opt.version} (${process.release.name} ${process.version})`;
  const suite = await suiteFiles(node);
  const fixtures = {};
  for (const f of FIXTURE_FILES(suite)) fixtures[f] = await readFile(join(node, f));
  const licenceText = licence(fixtures.LICENSE.toString('utf8'));
  const meta = { node: pins.node.version, toolchain: toolchainText, sha256: sha256(wasm) };
  const sources = {
    ...pins,
    build: {
      sources: SOURCES,
      flags: FLAGS,
      link: LINK,
      wasmOpt: WASM_OPT,
      toolchain: toolchainText,
    },
    wasm: { bytes: wasm.length, sha256: meta.sha256 },
    licence: sha256(licenceText),
    fixtures: Object.fromEntries(Object.entries(fixtures).map(([f, b]) => [f, sha256(b)])),
  };
  const out = {
    [join(GEN, 'zlib-wasm.js')]: moduleText(wasm, meta),
    [join(GEN, 'zlib-wasm.d.ts')]: DTS,
    [join(GEN, 'LICENSE')]: licenceText,
    [join(GEN, 'sources.json')]: `${JSON.stringify(sources, null, 2)}\n`,
  };
  for (const [f, b] of Object.entries(fixtures)) out[join(FIX, f)] = b;
  return out;
}

async function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, base)));
    else out.push(p);
  }
  return out;
}

async function check() {
  const js = await readFile(join(GEN, 'zlib-wasm.js'), 'utf8');
  const b64 = js.match(/^ {2}'([A-Za-z0-9+/=]+)';$/m)?.[1];
  if (!b64) throw new Error('zlib-wasm drift: zlib-wasm.js has no base64 body');
  const wasm = Buffer.from(b64, 'base64');
  const meta = { node: pins.node.version, toolchain: pins.build.toolchain, sha256: sha256(wasm) };
  const problems = [];
  if (meta.sha256 !== pins.wasm.sha256 || wasm.length !== pins.wasm.bytes)
    problems.push(`zlib-wasm.js bytes ${wasm.length}/${meta.sha256} ≠ sources.json`);
  if (js !== moduleText(wasm, meta)) problems.push('zlib-wasm.js text');
  if ((await readFile(join(GEN, 'zlib-wasm.d.ts'), 'utf8')) !== DTS)
    problems.push('zlib-wasm.d.ts');
  if (sha256(await readFile(join(GEN, 'LICENSE'))) !== pins.licence) problems.push('LICENSE');
  const want = new Set(Object.keys(pins.fixtures));
  for (const p of await listFiles(FIX)) {
    const rel = relative(FIX, p);
    if (!want.delete(rel)) problems.push(`unpinned fixture ${rel}`);
    else if (sha256(await readFile(p)) !== pins.fixtures[rel]) problems.push(`fixture ${rel}`);
  }
  for (const rel of want) problems.push(`missing fixture ${rel}`);
  if (problems.length) throw new Error(`zlib-wasm drift: ${problems.join('; ')}`);
  console.log(
    `zlib-wasm --check: ${wasm.length} bytes, ${meta.sha256}, ${Object.keys(pins.fixtures).length} fixtures`,
  );
}

if (mode === '--check') await check();
else {
  const out = await render();
  const sources = JSON.parse(out[join(GEN, 'sources.json')]);
  if (mode === '--write') {
    await rm(FIX, { recursive: true, force: true });
    for (const [p, body] of Object.entries(out)) {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    }
  } else {
    const drift = [];
    for (const [p, body] of Object.entries(out)) {
      const have = existsSync(p) ? await readFile(p) : null;
      if (!have?.equals(Buffer.from(body))) drift.push(relative(repo, p));
    }
    const extra = (await listFiles(FIX)).filter((p) => !(p in out)).map((p) => relative(repo, p));
    if (drift.length || extra.length)
      throw new Error(
        `zlib-wasm --rebuild drift on ${process.platform}-${process.arch} (built ${sources.wasm.sha256}): ${[...drift, ...extra].join(', ')}`,
      );
  }
  console.log(
    `zlib-wasm ${mode} on ${process.platform}-${process.arch}: ${sources.build.toolchain}, ${sources.wasm.bytes} bytes, ${sources.wasm.sha256}`,
  );
}
