/**
 * Shape of a parity case. Each `*.case.ts` under `cases/` default-exports one
 * of these. The runner executes `code` in real Node (via child_process) and in
 * the rifty runtime (in-process, through `@rifty/runtime-js/loader`), then
 * compares stdouts. Any divergence is a bug.
 */
export interface ParityCase {
  /** Files preloaded into the runtime's in-memory VFS, relative to /work/. */
  readonly setup?: { readonly files?: Readonly<Record<string, string>> };
  /** Source to evaluate as CJS in /work/main.js (or ESM in /work/main.mjs). */
  readonly code: string;
  /** If set, both runtimes must produce stdout matching this (in addition to matching each other). */
  readonly expected?: string | RegExp;
  /**
   * Module kind. Defaults to 'cjs'.
   *
   * - `'cjs'` / `'esm'` — module-shape parity (`node:path`, `node:buffer`, …).
   *   The rifty side runs through `@rifty/runtime-js/loader` only.
   * - `'http'` — opt-in `@rifty/net` registration mode. The rifty side ALSO
   *   imports `@rifty/net/register-builtins` so `require('node:http')` resolves,
   *   and both runtimes expose a normalised request-driver global,
   *   `__riftyHttpRequest(port, path, init?) => Promise<{ status, statusText,
   *   contentType, body }>`. On the Node side the driver is a real
   *   `http.request` to `127.0.0.1:<port>`; on the rifty side it is
   *   `dispatchToPort(port, new Request('http://preview.local:<port><path>'))`.
   *   This is the ONLY way to exercise rifty's `node:http` *server* surface
   *   head-to-head against Node — the default modes never register `node:http`
   *   (it lives in `@rifty/net`, which the runner does not import by default).
   *   The runner is a `tools/` harness already permitted to import higher
   *   layers (precedent: the WASI cases reach into `@rifty/runtime-wasi` +
   *   `@rifty/shadow-registry`).
   * - `'ts-esm'` — TypeScript-on-import ESM mode. Both `code` and any `.ts`
   *   `setup.files` are written verbatim and the entry is `main.ts`. The Node
   *   side spawns `process.execPath` on `main.ts` (Node v24 strips types
   *   natively; on older Node the runner falls back to the vendored `tsx`).
   *   The rifty side builds `createModuleLoader(vfs, { cwd, workspace,
   *   transformSource })` where `transformSource` runs the REAL esbuild WASI
   *   binary (`transformWithEsbuild` over `runWasi`, ADR-0052/0049) to strip
   *   types / lower JSX before the AST ESM rewrite — the same edge the headless
   *   opencode harness will use. Like `'http'`, this is a `tools/`-harness-only
   *   reach into `@rifty/runtime-wasi` + `@rifty/shadow-registry`.
   */
  readonly kind?: 'cjs' | 'esm' | 'http' | 'ts-esm';
}

export interface CaseRun {
  readonly file: string;
  readonly nodeStdout: string;
  readonly riftyStdout: string;
  readonly match: boolean;
  readonly diff?: string;
  readonly error?: string;
}
