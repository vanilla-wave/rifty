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
