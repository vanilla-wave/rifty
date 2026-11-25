/**
 * A host with no ES module loader (the isolate guest, where it needs `URL`) declares it
 * with its named gap before guest code. Then every ES module load throws that gap, and
 * `require` is Node's with `--no-require-module`: no `require(esm)` (`ERR_REQUIRE_ESM`),
 * no `module-sync` condition, no ESM detection for `require`, `process.features.require_module`
 * `false`. Undeclared (every other host): Node 24's defaults.
 */
let gap: (() => Error) | null = null;

export function declareNoEsmLoader(error: () => Error): void {
  gap = error;
}

/** The host's gap for an ES module load; `null` with a loader. */
export function noEsmLoaderGap(): (() => Error) | null {
  return gap;
}

export function requireModuleEnabled(): boolean {
  return gap === null;
}
