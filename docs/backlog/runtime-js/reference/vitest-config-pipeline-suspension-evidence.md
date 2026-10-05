# vitest-config-pipeline-suspension — evidence (2026-10-05)

Chromium e2e probes against the dev playground, exact pair vitest 4.1.11 +
vite 8.0.16 installed via `"overrides": {"vite": "8.0.16"}` (48 packages,
install exit 0 — the two-anchor Chokidar/root-URL patch fix landed the same
day, see ledger). Probes ran `node diag-probe.mjs` from the project cwd
(`/`), terminal buffer captured verbatim.

## Install (u12 e2e spec, first red)

```
npm: lightningcss@^1.32.0 → lightningcss-wasm@1.32.0 (substituted from shadow registry, ADR-0051)
npm: lightningcss@^1.32.0 materialized from shadow registry (rifty.shadow-substitution.lightningcss.v2)
npm: installed 48 package(s) in 12.0s
```

then, before the patch fix: `npm: install failed: vite root watcher patch
failed: expected exactly one Chokidar DirEntry.add anchor; found 2` (and
after that fix: `vite root URL patch failed: ... found 2`). Vite 8.0.16 ships
both patch anchors in TWO chunks — policy now patches every anchor.

## CLI surface

- `vitest --version` → `\nvitest/4.1.11 rifty-wasm node-v24.0.0\n> `, exit 0.
- `vitest --help` → full command/option listing, exit 0.
- `vitest run` → `\n\n> `, NO output, exit 0 (rifty-diag instrumented:
  `natural exit code=0 entry=returned drain=resolved ports=0`).

## Probe matrix (`node diag-probe.mjs`)

| probe | result |
|---|---|
| `import('vitest/node')` then log | P1-imported ✓ |
| `createVitest('test', {watch:false, config:false})` | P2-noconfig ✓ (later `close()` suspends) |
| `createVitest('test', {watch:false})` (vitest.config.ts) | SUSPENDS (no P2, silent drain exit 0) |
| `createVitest` with `./empty.config.ts` (`export default {}`) | SUSPENDS |
| same with `configLoader: 'bundle'` | SUSPENDS |
| `import('vite')`; `vite.createServer({root})` (config auto-found, no plugins) | V1, V2-noconfig, V3-withconfig ✓ |
| `vite.createServer({configFile:'./empty.config.ts', plugins:[{name:'x',config(c){return c;}}]})` | SUSPENDS (V1 only) |

Node v24 oracle: every row resolves.

## Reading

The wall is generic vite 8.0.16: `createServer` with BOTH a config file and
at least one plugin never settles — no handle, no rejection, silent drain
exit. `vitest run` drives exactly this pipeline via `createVitest`, before any
banner/output. The goal's vitest-main keepalive open question resolves to
this named wall (not a missing Worker handle class).
