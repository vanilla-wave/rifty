/**
 * Shape of a parity case. Each `*.case.ts` under `cases/` default-exports one
 * of these. The runner executes `code` in real Node (via child_process) and in
 * the rifty runtime (in-process, through `@riftydev/runtime-js/loader`), then
 * compares stdouts. Any divergence is a bug.
 */
export interface ParityCase {
  /**
   * Files preloaded from the case fs root. With `cwd: '/app'`, `app/data.txt`
   * is read by fs APIs as relative `data.txt`; a copy also sits beside
   * `/work/main.*` for relative module imports from the case entry.
   */
  readonly setup?: { readonly files?: Readonly<Record<string, string>> };
  /**
   * Relative-path ANCHOR for both runtimes, as an absolute POSIX path from the
   * case's fs root (default `'/'`). Rifty: `setProcessCwd(cwd)`; Node child:
   * `<workDir>/<cwd>` (created if absent). Setup files keep their root-relative
   * anchors — a case with `files: {'app/data.txt': …}, cwd: '/app'` reads it as
   * `data.txt`. This is what makes relative-path resolution bugs parity-visible:
   * at the historical pinned cwd `/`, an fs surface that DROPS cwd resolution
   * (treating `data.txt` as `/data.txt`) still resolved identically by accident.
   * The `process.cwd()` VALUES differ (Node: the absolute temp `<workDir>/<cwd>`;
   * rifty: `<cwd>`) — a case must never PRINT cwd or resolved-absolute paths,
   * only rely on the anchoring.
   */
  readonly cwd?: string;
  /** Optional stdin chunks written to both runtimes after the entry attaches listeners. */
  readonly stdin?: readonly Uint8Array[];
  /** Source to evaluate as CJS in /work/main.js (or ESM in /work/main.mjs). */
  readonly code: string;
  /** If set, both runtimes must produce stdout matching this (in addition to matching each other). */
  readonly expected?: string | RegExp;
  /**
   * Module kind. Defaults to 'cjs'.
   *
   * - `'cjs'` / `'esm'` — module-shape parity (`node:path`, `node:buffer`, …).
   *   The rifty side runs through `@riftydev/runtime-js/loader` only.
   * - `'http'` — opt-in `@riftydev/net` registration mode. The rifty side ALSO
   *   imports `@riftydev/net/register-builtins` so `require('node:http')` resolves,
   *   and both runtimes expose a normalised request-driver global,
   *   `__riftyHttpRequest(port, path, init?) => Promise<{ status, statusText,
   *   contentType, body }>`. On the Node side the driver is a real
   *   `http.request` to `127.0.0.1:<port>`; on the rifty side it is
   *   `dispatchToPort(port, new Request('http://preview.local:<port><path>'))`.
   *   This is the ONLY way to exercise rifty's `node:http` *server* surface
   *   head-to-head against Node — the default modes never register `node:http`
   *   (it lives in `@riftydev/net`, which the runner does not import by default).
   *   The runner is a `tools/` harness already permitted to import higher
   *   layers (precedent: the WASI cases reach into `@riftydev/runtime-wasi` +
   *   `@riftydev/shadow-registry`).
   * - `'ts-esm'` — TypeScript-on-import ESM mode. Both `code` and any `.ts`
   *   `setup.files` are written verbatim and the entry is `main.ts`. The Node
   *   side runs `main.ts` through a FULL TS transform (the vendored `tsx`), NOT
   *   Node's strip-only `--experimental-strip-types`, so codegen-requiring TS
   *   (`enum`, parameter properties) lowers the same way rifty's esbuild hook
   *   lowers it — strip-only would throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on
   *   those (ADR-0132).
   *   The rifty side builds `createModuleLoader(vfs, { cwd, workspace,
   *   transformSource })` where `transformSource` runs the REAL esbuild WASI
   *   binary (`transformWithEsbuild` over `runWasi`, ADR-0052/0049) to strip
   *   types / lower JSX before the AST ESM rewrite — the same edge the headless
   *   opencode harness will use. Like `'http'`, this is a `tools/`-harness-only
   *   reach into `@riftydev/runtime-wasi` + `@riftydev/shadow-registry`.
   * - `'sqlite'` — opt-in `node:sqlite` registration mode (ADR-0065). Like
   *   `'http'` for `@riftydev/net`'s `node:http`, the rifty side imports
   *   `@riftydev/net/sqlite/register-builtins` so `require('node:sqlite')` resolves
   *   to the sql.js-backed `DatabaseSync` shim, and it AWAITS
   *   `initSqliteEngine()` first so the synchronous `DatabaseSync` constructor
   *   has its WASM handle ready (the one async step the synchronous surface
   *   depends on). The case `code` is otherwise plain CJS — the Node side runs
   *   the genuine `node:sqlite` `DatabaseSync` (Node ≥22) with no preamble.
   * - `'exec-sync'` — opt-in `child_process.execSync` SAB-path mode (ADR-0084 #23).
   *   `execSync` is SAB-only by design (ADR-0011 — the in-realm fallback was
   *   removed as a silent stub), so the default loader path would throw
   *   `NotImplementedError`. This mode wires a REAL kernel `SyncRpcDispatcher` +
   *   `SabRing` + the v2 binary-frame encode/decodeReply round-trip and a
   *   synchronous in-realm child runner that captures stdout BYTES, then
   *   publishes the `__riftyKernelSyncCall` shim so the case's `execSync` returns
   *   a byte-exact Buffer. `setup.files` are exposed to the child via the sync
   *   mirror. The Node side runs the genuine `child_process.execSync` (a real
   *   subprocess) with no preamble — so binary stdout must be routed through a
   *   HEX channel (`out.toString('hex')`) to survive the harness's UTF-8 capture.
   */
  readonly kind?: 'cjs' | 'esm' | 'http' | 'ts-esm' | 'sqlite' | 'exec-sync';
}

/**
 * Validated case cwd: absolute, no `.`/`..` segments, default `'/'`. Shared by
 * both runners so a malformed cwd fails loudly and identically on each side.
 */
export function caseCwd(testCase: ParityCase): string {
  const cwd = testCase.cwd ?? '/';
  const segments = cwd.split('/').filter((s) => s !== '');
  if (!cwd.startsWith('/') || segments.some((s) => s === '.' || s === '..')) {
    throw new Error(`ParityCase.cwd must be an absolute POSIX path without dot segments: ${cwd}`);
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export interface CaseRun {
  readonly file: string;
  readonly nodeStdout: string;
  readonly riftyStdout: string;
  readonly match: boolean;
  readonly diff?: string;
  readonly error?: string;
}
