# ADR 0416: Optional Workbench SQLite deployment asset

Status: Accepted
Date: 2026-09-10

## Context

Issue #281: an embedder restores a Vite snapshot and runs `vite build` without
SQLite. Requiring its unused WASM URL adds deployment work. ADR-0065's engine
and synchronous builtin remain; ADR-0390 already supplies the matching asset.

## Decision

`deployment.wasm` and `deployment.wasm.sqlite` are optional. Undefined means
absent; supplied empty/malformed values still fail validation. No URL means no
SQLite bytes provider. First `DatabaseSync` use fails naming
`deployment.wasm.sqlite`; supplied URLs retain lazy real sql.js initialization.
Hosts without SQLite may omit `sql-wasm.wasm` from copied deployment assets.

Absence propagates in host bootstrap through owner, Node, dev-server and
recursive workers; guest environment never configures it (ADR-0267).
Following its version rule, atomically migrate `rifty.node-entry/v3` to `v4`
and `rifty.dev-server/v1` to `v2`; old protocols fail, no fallback reader.
This supersedes only ADR-0339's active v3 version and ADR-0272's active
custom dev-server v1 version; their launch and terminal semantics stay intact.

DEC-2 independent decision review: sqlite_decision, 2026-09-10; version bump
preserves ADR-0267's explicit host-shape rule. Keeping old versions would need
a new exception; sentinel URLs or a throwing provider violate the accepted
absence contract. No new transport or asset mechanism.

## Consequences

- Node/Vite deployments need no SQLite URL or asset; configured SQLite stays lazy.
- Deploy matching Worker assets together; old bootstrap versions are rejected.
- Engine, builtin removal, persistence and bytes API are outside this change.
