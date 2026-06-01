#!/usr/bin/env node
/**
 * Build-time vendoring of anomalyco/opencode's programmatic *server path* as a
 * committed, reproducible fixture for rifty's opencode-facade work (F01 / Spike C).
 *
 * What this pins
 * --------------
 * - PINNED_SHA below is the exact commit on opencode's `dev` branch we vendor.
 *   Re-run this script to refresh the fixture after bumping PINNED_SHA.
 *
 * What "server path" means
 * ------------------------
 * The target is the PROGRAMMATIC server entrypoint only:
 *
 *     import { Server } from "opencode/server/server"
 *     Server.listen(opts)
 *
 * NOT the CLI (`packages/opencode/src/index.ts`), which has a top-level
 * `drizzle-orm/bun-sqlite` import that `require()`s `bun:sqlite` and crashes at
 * import time outside Bun. The console/TUI, web app, desktop, SDK-codegen, SST
 * infra and stats packages are all pruned.
 *
 * Why we copy whole package `src/` dirs (not a trimmed file set)
 * --------------------------------------------------------------
 * A static import-graph trace from `server/server.ts` (following only static
 * `import/export … from`, resolving `@/` -> `./src/*`, the `#` imports map under
 * the `node` condition, and crossing every `@opencode-ai/*` workspace boundary
 * whose exports are `"./*": "./src/*.ts"`) reaches 470 internal `.ts` files
 * spanning SIX workspace packages:
 *
 *     opencode (306)  core (120)  llm (25)  effect-drizzle-sqlite (16)
 *     sdk (2)         plugin (1)
 *
 * plus 5 binary audio assets from `@opencode-ai/ui` and a tail of `.txt`/`.sql`/
 * `.md` prompt+schema assets imported by `opencode` and `core`. A regex tracer
 * cannot follow those non-TS assets, nor `.js`-specifier rewrites (NodeNext
 * style) nor `import()`-style dynamic imports, so we deliberately copy each
 * needed package's ENTIRE `src/` (plus its `package.json` + `tsconfig.json`) and
 * the upstream `packages/<name>/` layout. This keeps every `@opencode-ai/*`
 * export map resolvable and is robust against the tracer's blind spots. The
 * 470-file trace is the *documented minimal closure*; the copy is a superset of
 * it for correctness.
 *
 * `@opencode-ai/*` `workspace:*` refs are NOT npm dependencies — they ARE the
 * vendored source, so they are dropped from the dependency manifest (see below).
 *
 * Dependency snapshot
 * -------------------
 * `facade-manifest.json` (committed in the fixture) is a standalone, flattened
 * manifest of the EXTERNAL npm closure of the server path. `catalog:` refs are
 * resolved to the concrete versions from opencode's root `package.json`
 * `workspaces.catalog`; `workspace:*` refs are dropped (they are the vendored
 * source). The 4 native/wasm packages live in `optionalDependencies` so a native
 * build failure cannot abort the install (all 4 resolved as platform prebuilds
 * at pin time). Concrete `@ai-sdk/*` providers and cloud credential libs are
 * DROPPED: `provider/provider.ts` loads them via runtime-gated dynamic
 * `import()` (fetch-on-demand), so they are not part of the import-time closure.
 *
 * The materialized `node_modules` is ~217 MB and is NOT committed (see the
 * fixture-local `.gitignore`). The committed `facade-manifest.json` +
 * `facade-manifest.lock.json` (npm lockfile) reproduce it deterministically via
 * `npm ci` (327 packages, verified). Running this script re-materializes both
 * the source and `node_modules` from scratch.
 *
 * Zero non-builtin deps: shells out to the ambient `git` and `npm`, uses only
 * `node:*` builtins otherwise. Network access (the `git clone`) is required.
 *
 * License: opencode is MIT (see source/LICENSE in the fixture).
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_SHA = 'f401f01c05bead2fd0687004c912743d271e2b7b';
const PINNED_BRANCH = 'dev';
const REPO_URL = 'https://github.com/anomalyco/opencode';

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/shadow-registry/scripts -> repo root -> fixture dir
const REPO_ROOT = join(HERE, '..', '..', '..');
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'integration', 'fixtures', 'opencode');
const SOURCE_DIR = join(FIXTURE_DIR, 'source');
const DEPS_DIR = join(FIXTURE_DIR, 'deps');
const FACADE_MANIFEST = join(FIXTURE_DIR, 'facade-manifest.json');
const FACADE_LOCK = join(FIXTURE_DIR, 'facade-manifest.lock.json');

/**
 * Workspace packages reachable from the server path. We copy each one's whole
 * `src/` (a superset of the traced closure) plus its package metadata. `subdir`
 * is the package directory under the upstream `packages/` root; `pkgName` is the
 * `@opencode-ai/*` (or bare `opencode`) name whose `exports` map points at it.
 */
const KEEP_PACKAGES = [
  { subdir: 'opencode', pkgName: 'opencode' },
  { subdir: 'core', pkgName: '@opencode-ai/core' },
  { subdir: 'llm', pkgName: '@opencode-ai/llm' },
  { subdir: 'effect-drizzle-sqlite', pkgName: '@opencode-ai/effect-drizzle-sqlite' },
  { subdir: 'plugin', pkgName: '@opencode-ai/plugin' },
  // The SDK lives at packages/sdk/js (name "@opencode-ai/sdk", exports ./src/*).
  { subdir: join('sdk', 'js'), pkgName: '@opencode-ai/sdk' },
];

/**
 * Specific binary assets from `@opencode-ai/ui` imported by the server path via
 * `@opencode-ai/ui/audio/*` -> `packages/ui/src/assets/audio/*`. Copying the
 * whole `ui` package would drag in the entire Solid component tree; we only need
 * these five files, placed at the same relative path so the export resolves.
 */
const UI_AUDIO_FILES = [
  'bip-bop-01.mp3',
  'bip-bop-03.mp3',
  'nope-03.mp3',
  'staplebops-06.mp3',
  'yup-01.mp3',
];

/**
 * The flattened external-dependency manifest for the server path. Versions are
 * the concrete pins from opencode @ PINNED_SHA (`catalog:` refs resolved against
 * the root `workspaces.catalog`; semver ranges pinned to the catalog concrete).
 * `workspace:*` refs are intentionally absent (they are the vendored source).
 */
const FACADE_DEPENDENCIES = {
  // Concrete `@ai-sdk/*` providers are normally DROPPED (opencode dynamic-imports
  // them on demand — see the manifest description). `@ai-sdk/openai-compatible` is
  // the ONE exception we keep installed: it is opencode's bundled provider for any
  // OpenAI-compatible endpoint (`BUNDLED_PROVIDERS["@ai-sdk/openai-compatible"]` →
  // `createOpenAICompatible`), and keeping it materialized lets the Phase-3 LLM
  // round-trip gate resolve the dynamic import WITHOUT a runtime `npm install`
  // (which would hit the tool-execution ceiling). Pinned to opencode's own
  // catalog version (`packages/core/package.json` @ PINNED_SHA).
  '@ai-sdk/openai-compatible': '2.0.41',
  '@ai-sdk/provider': '3.0.8',
  '@effect/opentelemetry': '4.0.0-beta.66',
  '@effect/platform-node': '4.0.0-beta.66',
  '@modelcontextprotocol/sdk': '1.27.1',
  '@npmcli/config': '10.8.1',
  // `@effect/opentelemetry/Tracer` (imported by opencode's session/llm + agent)
  // pulls `./Resource.js`, which statically imports `@opentelemetry/resources` —
  // an OPTIONAL peer of `@effect/opentelemetry` (npm does not install optional
  // peers), so the hand-flattened set missed it. It is genuinely on the server
  // path's external closure; pinned to opencode's otel 2.6.x line. (Transitively
  // pulls `@opentelemetry/core`.)
  '@opentelemetry/resources': '2.6.1',
  // `@opencode-ai/llm`'s Bedrock protocol (`protocols/bedrock-event-stream.ts`)
  // statically imports these AWS Smithy packages; declared by the llm workspace
  // package but missed by the hand-flattened set.
  '@smithy/eventstream-codec': '4.2.14',
  '@smithy/util-utf8': '4.2.2',
  ai: '6.0.168',
  // `@opencode-ai/llm`'s Bedrock auth (`protocols/utils/bedrock-auth.ts`) signs
  // requests with aws4fetch; declared by the llm workspace package.
  aws4fetch: '1.0.20',
  'bonjour-service': '1.3.0',
  'cross-spawn': '7.0.6',
  'decimal.js': '10.5.0',
  diff: '8.0.2',
  'drizzle-orm': '1.0.0-rc.2',
  effect: '4.0.0-beta.66',
  fuzzysort: '3.1.0',
  'gitlab-ai-provider': '6.8.0',
  glob: '13.0.5',
  'gray-matter': '4.0.3',
  htmlparser2: '8.0.2',
  ignore: '7.0.5',
  immer: '11.1.4',
  'jsonc-parser': '3.3.1',
  'mime-types': '3.0.2',
  minimatch: '10.0.3',
  'npm-package-arg': '13.0.2',
  open: '10.1.2',
  'opencode-gitlab-auth': '2.0.1',
  'opencode-poe-auth': '0.0.1',
  remeda: '2.26.0',
  semver: '7.7.4',
  turndown: '7.2.0',
  ulid: '3.0.1',
  'vscode-jsonrpc': '8.2.1',
  'vscode-languageserver-types': '3.17.5',
  which: '6.0.1',
  ws: '8.21.0',
  'xdg-basedir': '5.1.0',
  zod: '4.1.8',
};

/**
 * Native/wasm packages held in `optionalDependencies` so a prebuild/native
 * compile failure on an exotic platform degrades gracefully instead of aborting
 * the whole install. All four resolved as platform prebuilds at pin time.
 */
const FACADE_OPTIONAL_DEPENDENCIES = {
  '@lydell/node-pty': '1.2.0-beta.12',
  '@parcel/watcher': '2.5.1',
  '@silvia-odwyer/photon-node': '0.3.4',
  'web-tree-sitter': '0.25.10',
};

function run(cmd, args, opts = {}) {
  process.stdout.write(`$ ${cmd} ${args.join(' ')}\n`);
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function cloneAtSha(scratch) {
  // Shallow-fetch exactly the pinned commit, then check it out detached.
  run('git', ['init', '-q', scratch]);
  run('git', ['-C', scratch, 'remote', 'add', 'origin', REPO_URL]);
  run('git', ['-C', scratch, 'fetch', '-q', '--depth', '1', 'origin', PINNED_SHA]);
  run('git', ['-C', scratch, 'checkout', '-q', PINNED_SHA]);
  const head = execFileSync('git', ['-C', scratch, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (head !== PINNED_SHA) {
    throw new Error(`clone HEAD ${head} != pinned ${PINNED_SHA}`);
  }
  process.stdout.write(`Checked out ${head}\n`);
}

function copyServerPathSource(scratch) {
  rmSync(SOURCE_DIR, { recursive: true, force: true });
  mkdirSync(join(SOURCE_DIR, 'packages'), { recursive: true });

  // Root metadata for context (license, root package.json with the catalog, tsconfig).
  for (const f of ['LICENSE', 'package.json', 'tsconfig.json']) {
    const src = join(scratch, f);
    if (existsSync(src)) copyFileSync(src, join(SOURCE_DIR, f));
  }

  for (const { subdir } of KEEP_PACKAGES) {
    const srcPkg = join(scratch, 'packages', subdir);
    const dstPkg = join(SOURCE_DIR, 'packages', subdir);
    mkdirSync(dstPkg, { recursive: true });
    // Whole src/ (superset of the traced closure: includes .txt/.sql/.md assets,
    // .js-specifier targets, and dynamic-import targets the tracer cannot see).
    cpSync(join(srcPkg, 'src'), join(dstPkg, 'src'), { recursive: true });
    for (const meta of ['package.json', 'tsconfig.json']) {
      const m = join(srcPkg, meta);
      if (existsSync(m)) copyFileSync(m, join(dstPkg, meta));
    }
    process.stdout.write(`Copied packages/${subdir}/src\n`);
  }

  // Five UI audio assets at their exported relative path.
  const uiAudioDst = join(SOURCE_DIR, 'packages', 'ui', 'src', 'assets', 'audio');
  mkdirSync(uiAudioDst, { recursive: true });
  for (const f of UI_AUDIO_FILES) {
    copyFileSync(join(scratch, 'packages', 'ui', 'src', 'assets', 'audio', f), join(uiAudioDst, f));
  }
  // Minimal ui package.json so the export map ("./audio/*") resolves.
  copyFileSync(
    join(scratch, 'packages', 'ui', 'package.json'),
    join(SOURCE_DIR, 'packages', 'ui', 'package.json'),
  );
  process.stdout.write(`Copied ${UI_AUDIO_FILES.length} ui audio assets\n`);
}

function writeFacadeManifest() {
  const description = [
    'Flattened KEEP set for the opencode programmatic server path (import { Server };',
    `Server.listen) from anomalyco/opencode @ ${PINNED_SHA}.`,
    'catalog:/workspace: refs resolved; workspace:* dropped (vendored as source);',
    'concrete @ai-sdk/* providers dropped (runtime dynamic import, fetch-on-demand).',
  ].join(' ');
  const manifest = {
    name: 'opencode-server-keep',
    version: '0.0.0',
    private: true,
    description,
    dependencies: FACADE_DEPENDENCIES,
    optionalDependencies: FACADE_OPTIONAL_DEPENDENCIES,
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(FACADE_MANIFEST, json);
  // Mirror into deps/package.json (the install root) so `npm ci` there works.
  mkdirSync(DEPS_DIR, { recursive: true });
  writeFileSync(join(DEPS_DIR, 'package.json'), json);
  process.stdout.write(`Wrote ${FACADE_MANIFEST}\n`);
}

function materializeDeps() {
  // Install into a scratch node_modules, then copy the lockfile back. We do NOT
  // commit node_modules (~217 MB) — only the committed lockfile reproduces it.
  const installRoot = mkdtempSync(join(tmpdir(), 'opencode-deps-'));
  copyFileSync(join(DEPS_DIR, 'package.json'), join(installRoot, 'package.json'));
  if (existsSync(FACADE_LOCK)) {
    // Deterministic reproduction from the committed lockfile.
    copyFileSync(FACADE_LOCK, join(installRoot, 'package-lock.json'));
    run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: installRoot });
  } else {
    // First materialization: resolve fresh and capture the lockfile.
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: installRoot });
  }
  const producedLock = join(installRoot, 'package-lock.json');
  if (existsSync(producedLock)) {
    copyFileSync(producedLock, FACADE_LOCK);
    // Keep a copy alongside deps/package.json too (npm ci convenience).
    copyFileSync(producedLock, join(DEPS_DIR, 'package-lock.json'));
  }
  process.stdout.write(
    `Materialized node_modules at ${installRoot} (NOT committed). Lockfile -> ${FACADE_LOCK}\n`,
  );
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'opencode-vendor-'));
  try {
    process.stdout.write(`Cloning ${REPO_URL}@${PINNED_SHA} (${PINNED_BRANCH})\n`);
    cloneAtSha(scratch);
    copyServerPathSource(scratch);
    writeFacadeManifest();
    materializeDeps();
    process.stdout.write('Done.\n');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
