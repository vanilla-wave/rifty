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
  /** Module kind. Defaults to 'cjs'. */
  readonly kind?: 'cjs' | 'esm';
}

export interface CaseRun {
  readonly file: string;
  readonly nodeStdout: string;
  readonly riftyStdout: string;
  readonly match: boolean;
  readonly diff?: string;
  readonly error?: string;
}
