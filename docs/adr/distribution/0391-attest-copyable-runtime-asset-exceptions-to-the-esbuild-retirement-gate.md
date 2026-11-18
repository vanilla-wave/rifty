# ADR 0391: Attest copyable runtime asset exceptions to the esbuild retirement gate

Status: Accepted
Date: 2026-09

## Context

ADR-0390 publishes the existing browser compilation inside Workbench. The
esbuild-retirement gate's blanket WASM/2 MB heuristics now reject QuickJS,
SQLite, cjs-module-lexer and two compiler outputs. Isolated gate: five failures;
packed Chromium consumer: PASS. Independent `assets_red_review` checked the
prior criteria and ADR-0316/0371: their esbuild provenance decisions remain.

## Decision

Keep all old gates. Under `packages/workbench/dist/assets/` only:

- Admit exact QuickJS/sql-wasm filenames, byte sizes and SHA-256 values.
- Exempt two exact compiler output filenames/size/SHA-256 values from the
  2 MB ceiling. Other content checks still run on those files.
- Exempt only cjs-module-lexer2.2.0's exact inline WASM literal (22,167 decoded
  bytes, SHA-256 b40099ca01477f581bd752acc8ed6d25c14b0e8beb9a00e0dc1744a2b041a104)
  from the WASM/base64 detector. Unknown adjacent literals still fail.

Concrete pins live in the gate. Updating a compiler output requires a reviewed
pin update and actual browser proof. This is distribution of the same existing
compiler/client graph, not a second esbuild client derivation or WASM source.
The esbuild member remains exclusively in its attested installed package.

Candidates: exclude assets directory or raise name-based limits — rejected,
would admit renamed payloads; source-map provenance analyzer — unnecessary
new machinery; exact two compiler fingerprints — selected despite update cost.

## Consequences

Existing path/reference/packlist/generated-client and gzip/base64 checks remain.
Negative probes substitute real esbuild bytes under admitted names, mutate
allowed WASM, add unknown inline WASM and exceed compiler limits. Hash-named
imports can change the TypeScript worker fingerprint after ordinary runtime
edits; that pin update stays explicit. No ADR is superseded.

- 2026-10-20 — upstream-twin runtime changes regenerate TypeScript-worker chunk imports; exact size stays 10,022,664 bytes. Pin refreshed; packed toolchain surface (15 first-party/73 external tarballs, Chromium agent/build) and retirement gate pass. No directory/size exemption added.
- 2026-10-20 — file-stdout imports refresh that same 10,022,664-byte worker to SHA-256 `03b5b25a62685f215f32e2173a028bb04ec1d1e0a7ae4ee16e17dfd23f085725`; packed toolchain surface and exact retirement gate pass.
## Corrections

- 2026-10-20 — ADR-0541 native resource-fetch imports change the TypeScript
  worker fingerprint (+30 bytes); re-pin exact bytes/SHA only. Compiler chunk,
  2 MB ceiling and negative payload tests unchanged; packed consumer proof.
- 2026-10-20 — Fetch abort/finalization correction changes hashed imports again;
  TypeScript worker byte size unchanged, exact SHA re-pinned. Same ceilings.
- 2026-10-20 — Fetch bootstrap process-cache repair changes the import hash;
  same TypeScript worker byte size and ceilings, exact SHA re-pinned.
- 2026-10-20 — Merge main7f8d0e8d7 (no-COI child transport): resolve competing
  TypeScript worker pins from the merged build, not either parent. Byte size
  unchanged; ceilings and negative probes retained.

- 2026-10-20 — integrate Fetch main40837803b with upstream esbuild: derive the TypeScript worker pin from the combined build; exact bytes/hash only, all other ceilings unchanged.
- 2026-10-20 — correct the two size claims above Corrections: current TypeScript worker is 10,022,694 bytes, SHA-256 `86a44c9e749fe4d5fcc318e2f77542e63c6f53db55463eddab2cca52a942d38b`. `tools/checks/esbuild-legacy-retirement.mjs` remains the authority.
- 2026-10-20 — PR #379 import ordering changes six hashed imports in that worker, no compiler body bytes. BASE rebuild reproduces the previous hash; current 10,022,694-byte output is SHA-256 `233d8b195a32eb12f7f8875c28ec7921d641af42ef027cb5250a02c1b3e922e4`. Exact pin updated; ceilings and negative-payload criteria unchanged.
- 2026-11-17 — PR #400 merges main a639e0810 (#402 UTF-8 BOM): competing TypeScript worker pins resolved from the combined `pnpm build:libs`, not either parent — 10,022,686 bytes, SHA-256 `b05c95ee2ae8a24de9ed364d003ab384e2637553190c6e0165e9cc34f0465de3`. Exact pin only; ceilings and negative probes unchanged.
- 2026-11-17 — PR #399 (process brand, ADR-0345 §Corrections) rebased on main 8d2efa6ad: its `process-own-identity.ts` helper renames five hashed chunk imports in that worker, no compiler body bytes. main rebuild reproduces `b05c95ee…`; the combined `pnpm build:libs` gives 10,022,686 bytes, SHA-256 `09240d003c45466130c6c86bd3c442a197c81a294ddfce6a15e150711683187e`. Exact pin updated; ceilings and negative-payload criteria unchanged.
- 2026-11-18 — PR #403 (`node:zlib` ceiling reasons) on main a187ce3e0: the `zlib.ts` reason strings rename six hashed imports in that worker (five `chunk-*`, one `module-loader-*`; 44 bytes), no compiler body bytes. Rebuild with main's `zlib.ts` reproduces `09240d00…`; `pnpm build:libs` at the branch gives 10,022,686 bytes, SHA-256 `d14abe45e285f126794a0dbcf61fda7c4cc1293e51e4c31eb30a9dac8192875f`. Exact pin updated; ceilings and negative-payload criteria unchanged.
- 2026-11-18 — PR #405 (isolate host, ADR-0557) runtime-js/io changes rename shared chunks the TypeScript worker imports; no compiler body bytes. Main BASE rebuild reproduces `d14abe45…`; the branch build is 10,022,686 bytes, SHA-256 `186e74d86c022b7c988d45f73c8e19474e23cfaa807c1eabfe647694258eb364`. Exact pin only; ceilings and negative probes unchanged.
