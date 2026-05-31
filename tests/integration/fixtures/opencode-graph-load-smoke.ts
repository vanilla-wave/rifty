/**
 * opencode GRAPH-LOAD smoke — standalone (run via `tsx`), NOT a vitest test.
 *
 * Forked from `real-vite-smoke.ts`. Drives the P0/P2 GRAPH-LOAD GATE: build a
 * memory/sync VFS holding the vendored opencode source (`source/packages/*`)
 * plus the materialized `deps/node_modules`, build a `createModuleLoader` wired
 * with the REAL esbuild WASI `transformSource` (ADR-0052) and the `node:sqlite`
 * shim (ADR-0065), then attempt `loader.import` of the PROGRAMMATIC entry
 * `packages/opencode/src/server/server.ts` (NOT `src/node.ts`, whose top-level
 * `bun:sqlite` crashes outside Bun — see Spike C / the fixture README).
 *
 * GATE: the module graph RESOLVES + EVALUATES and exposes `Server` with a
 * `Server.listen` function, with no unresolved-import error and no native
 * crash. `node:sqlite` must resolve to the shim; `#pty` is lazy and must not be
 * pulled on the static path.
 *
 * It replaces `globalThis.process` with rifty's shim (matching the worker realm
 * and `real-vite-smoke.ts`), which is incompatible with vitest's child-process
 * IPC — hence a standalone script driven by a spawning opt-in vitest test.
 *
 * Run directly (sandbox disabled — needs the 217MB deps; network only for the
 * `npm ci` materialization step if `node_modules` is absent):
 *   npx tsx tests/integration/fixtures/opencode-graph-load-smoke.ts
 *
 * Prints exactly one terminal marker line and exits:
 *   RIFTY_OPENCODE_GRAPH_LOAD_OK  (exit 0)  — Server.listen resolved + evaluated
 *   RIFTY_OPENCODE_GRAPH_LOAD_BLOCKED <one-line reason>  (exit 4) — real wall
 */
// Side-effecting forward import: registers `node:net`/`node:http`/`node:https`
// shapes with the shared builtin registry (mirrors real-vite-smoke.ts line 1).
// The opencode server statically imports `node:http`'s `createServer`.
import '../../../packages/net/src/register-builtins.ts';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync as realReadFileSync,
  readdirSync as realReaddirSync,
  statSync as realStatSync,
  writeFileSync,
} from 'node:fs';
import { dirname as nodeDirname, join as nodeJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __setCreateRequireImpl } from '../../../packages/runtime-js/src/builtins/module.ts';
import {
  installProcessGlobals,
  setProcessCwd,
} from '../../../packages/runtime-js/src/builtins/process.ts';
import { installTimerGlobals } from '../../../packages/runtime-js/src/builtins/timers.ts';
import { createModuleLoader } from '../../../packages/runtime-js/src/module-loader/index.ts';
import type { TransformSourceHook } from '../../../packages/runtime-js/src/module-loader/index.ts';
import { runWasi } from '../../../packages/runtime-wasi/src/index.ts';
import { createMemoryFs, setSyncMirror } from '../../../packages/vfs/src/internal/index.ts';
import {
  loadVendoredEsbuildWasm,
  transformWithEsbuild,
} from '../../../tools/shadow-registry/src/esbuild-binding.ts';

// biome-ignore lint/suspicious/noExplicitAny: smoke harness.
type Any = any;
const realExit = process.exit.bind(process);
const realEnv = { ...process.env };
const log = (m: string): void => {
  process.stdout.write(`[opencode-graph-load] ${m}\n`);
};

const HERE = nodeDirname(fileURLToPath(import.meta.url));
const FIXTURE = nodeJoin(HERE, 'opencode');
const DEPS_DIR = nodeJoin(FIXTURE, 'deps');
const DEPS_NM = nodeJoin(DEPS_DIR, 'node_modules');
const SRC_PACKAGES = nodeJoin(FIXTURE, 'source', 'packages');

// Mount point inside the VFS. Everything lives under one root so the resolver's
// node_modules walk and relative resolution have a single coherent tree.
const ROOT = '/workspace';
const VFS_NM = `${ROOT}/node_modules`;
// Programmatic server entry — the GATE target. NOT src/node.ts.
const ENTRY = `${ROOT}/packages/opencode/src/server/server.ts`;

setTimeout(() => {
  log('TIMEOUT (300s) — forcing exit');
  realExit(99);
}, 300_000).unref?.();

/** Materialize `deps/node_modules` via `npm ci` if absent (network). */
function ensureDeps(): void {
  if (existsSync(DEPS_NM)) {
    log('deps/node_modules present — skipping npm ci');
    return;
  }
  log('deps/node_modules absent — running `npm ci` (needs network) ...');
  execFileSync('npm', ['ci'], { cwd: DEPS_DIR, stdio: 'inherit' });
  if (!existsSync(DEPS_NM)) {
    throw new Error(`npm ci completed but ${DEPS_NM} is still absent`);
  }
  log('deps materialized');
}

/**
 * Recursively copy an on-disk directory tree into the sync VFS at `vfsBase`.
 * Symlinks are dereferenced (npm hoists/links some packages); cycles are
 * guarded by skipping already-visited real directories. Returns the file count.
 */
function copyTreeIntoVfs(fsSync: Any, enc: TextEncoder, diskBase: string, vfsBase: string): number {
  let files = 0;
  const seenDirs = new Set<string>();
  const walk = (diskDir: string, vfsDir: string): void => {
    let realDir: string;
    try {
      realDir = realStatSync(diskDir).isDirectory() ? diskDir : diskDir;
    } catch {
      return;
    }
    if (seenDirs.has(realDir)) return;
    seenDirs.add(realDir);
    fsSync.mkdirSync(vfsDir, { recursive: true });
    let entries: Array<{ name: string; isDir: boolean }>;
    try {
      entries = realReaddirSync(diskDir, { withFileTypes: true }).map((d) => {
        let isDir = d.isDirectory();
        if (d.isSymbolicLink()) {
          try {
            isDir = realStatSync(nodeJoin(diskDir, d.name)).isDirectory();
          } catch {
            isDir = false;
          }
        }
        return { name: d.name, isDir };
      });
    } catch {
      return;
    }
    for (const e of entries) {
      const diskPath = nodeJoin(diskDir, e.name);
      const vfsPath = `${vfsDir}/${e.name}`;
      if (e.isDir) {
        walk(diskPath, vfsPath);
      } else {
        let bytes: Uint8Array;
        try {
          bytes = realReadFileSync(diskPath);
        } catch {
          continue;
        }
        fsSync.writeFileSync(vfsPath, bytes);
        files++;
      }
    }
  };
  walk(diskBase, vfsBase);
  return files;
}

/**
 * Build the esbuild type-strip `transformSource` — the SAME edge the parity
 * runner's `kind: 'ts-esm'` uses (ADR-0052): strip TS types / lower JSX with the
 * REAL vendored esbuild WASI binary, selecting the loader by extension. The
 * wasm bytes are read once and copied into a plain ArrayBuffer-backed view so
 * they satisfy `BufferSource`.
 */
function buildTsTransform(): TransformSourceHook {
  const raw = loadVendoredEsbuildWasm();
  const wasm = new Uint8Array(raw.byteLength);
  wasm.set(raw);
  // Disk-persistent content-hash cache for the per-file esbuild WASI strip.
  // The strip is a deterministic single-file transform (output depends only on
  // source + loader), so caching by sha256(loader+source) lets a warm
  // graph-load run skip ~900 runWasi spawns — the cold run populates it. This
  // keeps the (heavy) graph-load smoke inside an agent's no-output watchdog and
  // makes iterating on missing-builtin walls practical.
  const cacheDir = '/tmp/rifty-opencode-strip-cache';
  mkdirSync(cacheDir, { recursive: true });
  return async ({ source, loader, workspace }) => {
    const key = createHash('sha256').update(loader).update('\0').update(source).digest('hex');
    const cachePath = nodeJoin(cacheDir, `${key}.js`);
    if (existsSync(cachePath)) return realReadFileSync(cachePath, 'utf8');
    const { code } = await transformWithEsbuild(runWasi, wasm, {
      source,
      loader,
      workspace,
      format: 'esm',
      jsx: loader !== 'ts' ? 'automatic' : undefined,
    });
    writeFileSync(cachePath, code);
    return code;
  };
}

async function main(): Promise<void> {
  ensureDeps();

  // node:sqlite shim (ADR-0065): register the builtin and bring up the sql.js
  // WASM engine BEFORE swapping `globalThis.process` for rifty's shim. The
  // engine's `locateFile` resolves the WASM path via `process.getBuiltinModule`
  // (real Node only) — the rifty process shim does not provide it — and the
  // handle is memoised, so initialising here keeps the synchronous DatabaseSync
  // ctor on the static graph supplied with a ready engine. Side-effecting
  // forward imports, same as the parity runner's `installSqliteMode`.
  await import('../../../packages/net/src/sqlite/register-builtins.ts');
  const { initSqliteEngine } = await import('../../../packages/net/src/sqlite/engine.ts');
  await initSqliteEngine();
  log('node:sqlite shim registered + engine ready');

  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  installProcessGlobals();
  installTimerGlobals();

  // opencode reads its DB path / mDNS toggle from process.env. Force the
  // in-memory sqlite path and disable mDNS so the static graph carries no
  // network/native expectation. NODE here selects the `node` export/imports
  // condition (#db -> db.node.ts, #pty -> pty.node.ts).
  (globalThis as Any).process.env = {
    ...realEnv,
    OPENCODE_DB: ':memory:',
    OPENCODE_DISABLE_MDNS: '1',
    NODE_ENV: 'production',
  };
  setProcessCwd(ROOT);

  const enc = new TextEncoder();

  // Materialize the vendored source packages and the npm node_modules into the
  // sync VFS. The esbuild WASI transform mounts `workspace` (= ROOT) as its sole
  // preopen against the GLOBAL sync mirror, so the source must live in fsSync
  // (which IS the mirror set above).
  fsSync.mkdirSync(ROOT, { recursive: true });
  fsSync.writeFileSync(
    `${ROOT}/package.json`,
    enc.encode(
      JSON.stringify({ name: 'opencode-graph-load-host', version: '0.0.0', private: true }),
    ),
  );
  log('materializing source/packages -> VFS ...');
  const srcFiles = copyTreeIntoVfs(fsSync, enc, SRC_PACKAGES, `${ROOT}/packages`);
  log(`source: ${srcFiles} files`);
  log('materializing deps/node_modules -> VFS (217MB, slow) ...');
  const nmFiles = copyTreeIntoVfs(fsSync, enc, DEPS_NM, VFS_NM);
  log(`node_modules: ${nmFiles} files`);

  // The vendored `@opencode-ai/*` workspace packages must be resolvable as bare
  // specifiers. They are NOT under node_modules (they ARE the vendored source).
  // Symlink them into node_modules so the resolver's node_modules walk finds
  // them. opencode source packages live at packages/<dir>; each declares its
  // own name in package.json. Mirror them under node_modules/<name>.
  linkWorkspacePackages(fsSync, enc);

  const wasm = loadVendoredEsbuildWasm();
  log(`esbuild wasm: ${wasm.byteLength} bytes`);

  const loader = createModuleLoader(fsSync, {
    cwd: ROOT,
    workspace: ROOT,
    transformSource: buildTsTransform(),
  });
  __setCreateRequireImpl((from: string) => {
    const fromPath = from.startsWith('file://') ? decodeURIComponent(from.slice(7)) : from;
    const req = ((id: string) => loader.require(id, fromPath)) as Any;
    req.resolve = (id: string) =>
      loader.resolver.resolve(id, { fromFile: fromPath, esm: false }).id;
    req.cache = {};
    req.extensions = {};
    req.main = undefined;
    return req;
  });

  log(`importing programmatic entry: ${ENTRY} ...`);
  const ns = (await loader.import(ENTRY, `${ROOT}/__entry__.mjs`)) as Any;

  // Server is re-exported as a namespace: `export * as Server from "./server"`.
  const Server = ns.Server;
  if (!Server || typeof Server !== 'object') {
    throw new Error(
      `graph evaluated but did not expose a Server namespace (got ${typeof Server}); exports: ${Object.keys(ns).join(',')}`,
    );
  }
  if (typeof Server.listen !== 'function') {
    throw new Error(
      `Server exposed but Server.listen is ${typeof Server.listen} (expected function); Server keys: ${Object.keys(Server).join(',')}`,
    );
  }
  log(`GRAPH LOADED — Server.listen is ${typeof Server.listen}`);
  log('RIFTY_OPENCODE_GRAPH_LOAD_OK');
  realExit(0);
}

/**
 * Mirror each vendored `@opencode-ai/*` (and bare `opencode`) workspace package
 * into `node_modules/<name>` by copying its tree, so the resolver's bare-name
 * node_modules walk finds the workspace packages (which are vendored as source,
 * not installed). The package name comes from each package.json `name`.
 */
function linkWorkspacePackages(fsSync: Any, enc: TextEncoder): void {
  let pkgDirs: string[];
  try {
    pkgDirs = realReaddirSync(SRC_PACKAGES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const dir of pkgDirs) {
    const pjPath = nodeJoin(SRC_PACKAGES, dir, 'package.json');
    let name: string | undefined;
    try {
      name = JSON.parse(realReadFileSync(pjPath, 'utf8')).name as string;
    } catch {
      continue;
    }
    if (!name) continue;
    const vfsTarget = `${VFS_NM}/${name}`;
    copyTreeIntoVfs(fsSync, enc, nodeJoin(SRC_PACKAGES, dir), vfsTarget);
  }
}

main().catch((e) => {
  const err = e as Error;
  // One-line wall reason for the GATE: prefer the message + the first stack
  // frame that points at a vendored/source file so the nextBlocker is exact.
  const msg = (err?.message ?? String(e)).split('\n')[0];
  const frame =
    (err?.stack ?? '')
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l.includes('/workspace/') || l.includes('opencode/source/')) ?? '';
  log(`UNCAUGHT: ${err?.stack ?? e}`);
  log(`RIFTY_OPENCODE_GRAPH_LOAD_BLOCKED ${msg}${frame ? ` @ ${frame}` : ''}`);
  realExit(4);
});
