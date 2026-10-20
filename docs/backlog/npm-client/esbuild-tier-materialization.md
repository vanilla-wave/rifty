---
area: npm-client
status: ready
title: Preserve attested source pins while selecting the host runtime tier for replay and snapshots
created: 2026-10-20
why: COI snapshot restore still materializes the no-COI facade and binding; current-catalog tier changes cannot replay their existing source offline
epic: esbuild-upstream-twin
sources: [ADR-0543, ADR-0346, ADR-0398, ADR-0420]
code: [packages/npm-client/src/installer-sources.ts, packages/npm-client/src/installer-walk.ts, packages/workbench/src/glue/dep-snapshot-application.ts, packages/workbench/src/glue/install-stamp-authority.ts]
---

## Context

Host snapshot carrier: real instant Vite build succeeds, lock still names
esbuild.v2 rather than wasm-node.v1. Fresh COI installer and stock Node runtime
already work; wiring the host alone would leave snapshot/claim reuse on the
old execution policy. This is a current-catalog policy selection, never a
migration of an obsolete catalog trace.

## Acceptance

1. Installing the opposite tier over a valid current-catalog 0.28.0 trace
   reuses the exact acquisition pin/cache offline; only materialization/trace
   select the requested tier. COI facade executes like its stock Node twin. → I1/I4
2. Explicit COI snapshot preparation retains every acquisition/transitive byte
   and version, projects the facade/receipt through the existing recipe owners,
   and grants no generated-runtime binding. No registry access, including when
   ordinary packages have no replay tarball. Restore and application use one
   projection; omitted tier preserves existing low-level helper behavior. → I1
3. Explicit no-COI snapshot preparation preserves the legacy 0.28.0 files,
   trace and binding. A COI 0.28.2 snapshot fails with a named no-COI refusal
   before any destination mutation. → I4
4. Install claim identity includes the explicit host runtime policy. Opposite
   tiers cannot reuse an identical stamp merely because catalog/deps match;
   ordinary same-tier checks, epochs and lock hashes retain their owners. → I1/I4
5. Old-catalog/malformed trace or corrupt/missing source cache is refused before
   projection publishes files or trust; no receipt is relabelled without its
   existing integrity and manifest checks. → I1/I4; ADR-0346/0398

## Reference contract

`installer-esbuild-upstream.test.ts`: real upstream 0.28.0 tarball, existing
opposite-tier trace, registry capability removed; Node facade execution.
`dep-snapshot-runtime-tier.test.ts`: committed Vite snapshot (253 real files,
only esbuild has replay cache), exact bytes/pins, both tiers and pre-mutation
faults; real MemoryFs install claims. `esbuild-upstream-host.spec.ts` is the
integrating host RED; host wiring stays in cutover.

## Fault matrix

| Authority | Boundary / axis | Proof |
|---|---|---|
| Acceptance 1 → I1/I4 | source replay / provenance-lie | same validated source, changed recipe; offline both directions |
| Acceptance 2/3 → I1/I4 | snapshot projection / sibling-drift | COI projection, exact no-COI preservation, host RED |
| Acceptance 3/5 → ADR-0346 | snapshot admission / corrupt-input | incompatible pin/cache/trace fails before target writes |
| Acceptance 4 → I1/I4 | install claims / poisoned-cache | distinct policy identities, existing epoch/hash suites |

Existing acquisition FIFO, snapshot preflight and stamp authority own
publication. No new transport or coordination state.

## Challenge

challenge: 2026-10-20 — clear; select policy over attested source bytes through
existing recipe/lock writers. Full reinstall cannot restore offline snapshots:
ordinary tarballs are intentionally absent. Duplicating whole snapshot assets,
a conditional generated-client facade, or rewriting upstream files adds work
or hides execution policy. Preserve existing source/version inputs instead.

## Out of scope

Workbench host wiring, Vite gates/lanes, generated-module import exclusion and
compat/ADR closure remain cutover. No catalog migration, registry resolution
refresh, new cache, second lock/claim writer or per-version admission list.

## Decisions

- ready-verdict: 2026-10-20 — Contract+RED @ 3a2a449c7973a21de811fd570a3e1c5b9f068664
- 2026-10-20 — ADR-0543 tier selection applies to current-catalog replay and
  snapshot materialization too. Its sources and transitive pins stay fixed.
- 2026-10-20 — derive the COI claim identity from the existing build identity
  plus the explicit tier; retain the existing no-COI identity. Snapshot source
  identity is validated before producing selected-tier preparation evidence.
