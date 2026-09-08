# Copyable Workbench runtime assets

## Baseline and RED — 2026-09-08

Baseline c798a8e84a6d1489c89aeefe3788ceda7d0570e5; Node24.16.0,
Playwright1.60.0, Vitest2.1.9.

`pnpm test:packed-consumer` builds/packs the real packages and typechecks the
consumer. Its build now first copies the published runtime directory:
`AssertionError: packed Workbench contains copyable runtime assets`.
This is the expected missing-artifact assertion, not an import/typecheck failure.

The host main uses ordinary URLs for all six Worker entries, SW and WASM;
Vite host aliases/worker compilation settings are absent. The existing kernel
wrapper/alias source files remain only as prior test references until their
ownership moves to publishing during implementation. The completed host needs
neither file. `copy-assets.mjs` copies all relative chunks, not just entry names.

The unchanged packed browser journey remains real Vite7.3.6/HMR/SQLite plus
producer raw/HTTP-decoded snapshot restore. The added copied toolchain probe
uses existing public SDK/VM behavior (`runInNewContext('40 + 2')`), guarding the
lexical compiler closure; it adds no SDK/runtime policy.

Prior source-wrapper timing criteria are kept and retargeted to the package-
owned wrapper; published builtin-alias targets remain verified. No test is
weakened to accept a missing runtime. Package source exports remain unchanged.

`pnpm lint`, `pnpm backlog:check`, `pnpm refs:check` pass on preparation.
Producer's additional retained-acquisition test passes10/10 without code changes;
it is prior-slice hardening, not a new asset obligation.

## Implementation probes

The first packed run reached native SW registration and rejected ESM SW imports:
Workbench registers a classic SW. Package build emits SW as a standalone IIFE;
the six Workers retain ESM splitting. The next run passed Vite/HMR/SQLite and
both producer restores, then found a false observation in the new SDK probe.

Independent `assets_red_review` verified at BASE: runtime-js worker-entry:84–88
prints eval results to stdout and returns successful `value: undefined`;
existing no-coi-vm-browser-proof uses runtime stdout. Correct the probe to
print `vm.runInNewContext('40 + 2')`, require successful result and exact `42\n`.
The VM/compiler invocation remains mandatory; this corrects an invalid oracle,
not production behavior. Raw runs: assets-green.log and assets-green-2.log in
the current session's temporary evidence.

`pnpm test:packed-consumer` passes77.79s after that correction: real copied
classic SW/module Workers, Vite7.3.6 preview/native HMR, SQLite, both producer
restores without registry requests, and exact VM stdout42. Node24.16.0,
Playwright1.60.0. Existing static wrapper/alias/compiler suites15/15 pass.
The asset build rejects emitted external/missing edges and eager eval compiler
inputs from the unconditional runtime/toolchain boot closure.

Full `pr:check` first run24/25: only esbuild-legacy-retirement failed, reproduced
in isolation. Its all-WASM/2 MB heuristics predate bundled Workbench assets;
they rejected exact QuickJS/SQLite, cjs-module-lexer and TypeScript bytes.
Independent prior-criterion/ADR check (`assets_red_review`) confirmed ADR-0316/
0371 prohibit another esbuild source, not those existing runtime dependencies.
ADR-0391 records exact size/SHA exceptions; no directory exclusion or general
ceiling increase. Real esbuild bytes in raw/gzip/base64, changed/renamed permitted
WASM and unknown adjacent inline WASM stay rejected. All old criteria remain.

Final `pnpm pr:check`:25/25 PASS. Under three simultaneous full gates from
different worktrees, test:run reported18 failures in8 files (15 explicit Vitest
timeouts; host load13.0/21.0/27.5 on12 CPUs). Its mandatory isolated rerun passed
all8 without code/timeout changes; parity passed66.9s. Inventory negative
probes10/10, current build fingerprints reproduced. No surviving failure.

VM reference: `node -e 'console.log(process.version); console.log(require("node:vm").runInNewContext("40 + 2"));'`
prints `v24.16.0` and `42`, matching the copied worker's exact stdout proof.
