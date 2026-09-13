# ADR 0435: Follow npm tar root stripping for materialized installs

Status: Accepted
Date: 2026-09-13

## Context

Benchmark baseline found missing React declarations despite successful install.
Original @types/react19.3.0 archive uses `react/`, while rifty stripped only
`package/`. npm11.17.0/pacote21.5.1 strips one component (`strip:1`), verified
against original bytes and valid synthetic archives. Native Node24.16 tsc passes;
rifty tsc/Monaco reported TS2688/7016/7026.

## Decision

Normalize npm payload paths at `extractTarGz`: remove one component independently
of its name; preserve raw outer traversal rejection and ordinary property names.
The raw tar parser keeps names unchanged for Eddy containers.

Special-casing DefinitelyTyped at link time was rejected: native `widget/`,
`./widget/`, multi-root and ordinary-property controls require one generic boundary.
The existing unpacker is the minimal interface; no linker rewrite or new package layer.

Add `npmTarballLayout: strip-one-component-v1` to existing install-artifact identity
(ADR-0261). Re-bake materialized snapshots through their producer. Raw tarball cache
bytes/integrity stay valid; old materialized trees must not retain current authority.

## Proof

`packages/npm-client/src/_test-fixtures/types-react-19.3.0/` retains original archive,
registry manifest, npm file/byte oracle and path variants. Regression tests compare
all16 original files, generic roots, flat members and `__proto__`/`constructor`.
Existing traversal tests remain; old materialized identity is rejected.
Goal trace: agent-bench Acceptance8 → I8; UI diagnostics observation → I5.
