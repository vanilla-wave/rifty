# ADR 0241: Install artifact identity for dependency trees

Status: Accepted
Date: 2026-07

> TL;DR: snapshots and install stamps trust a dependency tree only when its
> exact package.json text and deterministic install-artifact identity match the
> current installer policy; legacy/mismatched claims re-run arrival.

## Context

Snapshot/stamp v1 identifies a tree by template/slug plus flattened dependency
maps. The same package.json request can therefore reuse bytes produced by an
older shadow override, internals shim, or generated esbuild runtime. A current
dependency request is not proof of current install artifacts.

## Decision

- Define one `installArtifactIdentity` as `sha256:<hex>` over canonical JSON of
  exact `bakedOverrides`, `internalsShims`, `esbuild-runtime-policy.json`, and
  the generated esbuild output digest. Object keys sort recursively; arrays
  preserve declared order; strings and shim file contents remain byte-exact.
- Snapshot and install-stamp schema v2 carry `installArtifactIdentity` plus the
  exact package.json text that produced the tree. Missing identity/text,
  malformed v2, identity mismatch, or text mismatch is untrusted: snapshot
  restore falls through to real install; stamp reuse re-runs dependency
  arrival. v1 gets the same miss behavior.
- One shared payload constructor/parser owns v2 shape and comparisons for bake,
  restore, command install, boot promotion, and reuse. This adds no writer,
  lock, generation, recheck, or other coordination guard.
- A committed snapshot may migrate to v2 without a full bake only after a tool
  proves its embedded install-artifact bytes exactly equal the current
  generated policy output. Any absent/mismatched byte forces `pnpm
  snapshots:bake`; metadata-only trust is forbidden.
- `playground/install-stamp-authority` remains open: this identity closes what a
  claim attests, not the existing multi-writer ownership problem.

## Fault matrix

| Fault | Required outcome |
|---|---|
| `lossy-aggregate` | Exact package.json text distinguishes section moves, overrides, and other request edits hidden by a flat dep map. |
| `provenance-lie` | A claim lacking the current artifact identity is a miss, never “installed/current”. |
| `poisoned-cache` | Stable slug/template with changed derived bytes cannot reuse the old tree; reinstall/re-bake supplies a new identity. |

## Consequences

- Deploying changed overrides, shims, policy, or generated output invalidates old
  snapshots/stamps even when package.json is unchanged.
- Schema v2 causes one deliberate reinstall for legacy persisted trees; instant
  startup remains available after trusted snapshots are re-baked or proven.
- Identity is not a full node_modules content hash. Post-install corruption and
  the single-writer refactor remain in their existing backlogs.
