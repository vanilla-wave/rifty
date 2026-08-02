---
area: npm-client
status: draft
title: Shadow recipe v2 embedded-source authority
created: 2026-08-02
why: validated bundled bytes are still resolved, cached, installed, and locked again as a standalone child instead of remaining one embedded source
user_story: As a browser-IDE user installing or reopening LightningCSS, I want its reviewed embedded dependency consumed from the parent archive without a second registry source
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/lightningcss-wasm-1.32.0-packument.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/installer-lockfile-reader.ts
  - packages/npm-client/src/linker.ts
---

## Context

The acquisition-validation predecessor rejects registry projection and embedded
manifest drift at the existing shared ingress. It intentionally preserves the
current standalone `napi-wasm` traversal and lock topology. This second
dependency-ordered unit consumes the already-validated embedded source without
adding a resolver, cache, lock writer, trace protocol, Eddy source, or public
recipe API. The materialized-bin successor from PR #237 remains the sole
files → aliases → bins → shims → lock → reports commit owner.

Protocol-v2 completeness is a downstream concern. This item keeps the current
trace protocol and changes only traversal, internal pinned-package facts,
npm-compatible lock topology, and the two existing Eddy completeness gates.

## Reference contract

- The predecessor supplies exact current registry maps, the SRI-verified
  official `lightningcss-wasm@1.32.0` archive, and validated embedded
  `napi-wasm@1.1.3` bytes.
- npm's v3 lock records the parent dependency and bundle list plus the embedded
  child at its physical nested path with `version` and `inBundle: true`; it does
  not acquire or install a second root child.
- ADR-0335 keeps replay lock-authoritative and offline. Current protocol remains
  sufficient for this topology; complete behavior provenance stays with the
  protocol-v2 child.

## Acceptance

- For a validated registry-backed recipe acquisition, remove bundled names
  from ordinary required/optional prefetch and traversal while preserving the
  parent's complete required map. Do not special-case LightningCSS or
  `napi-wasm`; derive membership from the decoded recipe.
- Root and nested fresh installs retain the real embedded child under the
  acquired parent. No standalone child packument, tarball, cache entry,
  `InstallResult.packages` member, root tree, or bin exists.
- Fresh locks record exact parent `dependencies` and `bundleDependencies`, plus
  the embedded child at `<parent>/node_modules/<name>` as exactly its validated
  version and `inBundle: true`. The parent and child facts settle through the
  existing linker-owned lock builder; no second writer or public package shape.
- Matching current-protocol root/nested replay reads only the parent cache
  entry, requires the embedded manifest version to equal the exact child lock
  version and satisfy the recorded recipe range, regenerates the same tree/
  reports, performs zero registry reads, and leaves raw lock bytes unchanged.
- Generic Eddy adoption seeds and reads the parent tarball only. Client and
  service completeness gates exclude only plan-proven embedded child paths, so
  a valid bundle never falls back to a child registry source. Forged `inBundle`
  or malformed shadow trace remains an ordinary completeness gap: the client
  declines to standard resolution and the service refuses storage.
- Acquired registry-twin bins remain suppressed; registry alias materialization
  continues through the landed phased commit boundary. Preserve validation,
  data, materialized-bin, planner, registry-fault, and ordinary package suites.
  Add one concise npm-client CHANGELOG entry.

## Parity cases

1. Root and nested fresh installs retain all four real embedded members with no
   standalone child source/tree/result/bin and exact npm-compatible lock facts.
2. Matching current-protocol root and nested locks replay offline from only the
   parent cache entry to byte-identical tree/report/lock state.
3. Generic Eddy root/nested adoption carries only ordinary source tarballs plus
   the parent; both client adoption and service storage accept the plan-proven
   embedded child without weakening missing ordinary-tarball rejection.
4. A locked embedded version that disagrees with the extracted manifest or its
   recorded range fails `EBROKENLOCK` before link/report/lock mutation.
5. Existing acquired-bin suppression, alias commit faults, registry bounds,
   and generic-source gate remain green.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| provenance-lie / poisoned-cache | replayed parent bytes, embedded manifest, recipe range, and child lock fact agree before linking | root/nested current-protocol replay plus embedded version mutation |
| observable-order | verified membership filters prefetch/traversal; embedded validation precedes link/report/lock | exact root/nested registry/cache/VFS ledgers |
| torn-state | existing files/aliases/bins/shims/lock/report commit boundary remains unchanged and retryable | inherited materialized commit abort table |
| quota-perm-fail | alias/bin/lock failures publish no report/result/lock and retry reconciles | inherited materialized commit fault table |
| sibling-drift | fresh, replay, Eddy client, and Eddy service use one plan-proven embedded-path rule | real-tar carrier plus service completeness regression and finite generic-source gate |

## Out of scope

- Protocol-v2 acquisition/materialization/bin provenance, literal-v2 replay,
  full corruption tables, Workbench FIFO, and Chromium v2 lock proof;
  `npm-client/shadow-recipe-v2-protocol-replay-authority` owns them.
- Matching non-bundled required/retained-optional traversal, omitted optionals,
  non-empty peer handoff, and accepted scoped keys;
  `npm-client/shadow-recipe-v2-dependency-projection-execution` owns them.
- npm same-command collision settlement, peer placement, Sass, a public/custom
  recipe SPI, raw concurrent public `install()`, or any new resolver/cache/lock/
  FIFO/coordination mechanism.

## Decisions

- `split-predecessor:
  f5dbb4e021380dbdbbd964e33b434e47c2348618`; the second consecutive blocked
  checkpoint forced validation and embedded-source topology into separate
  dependency-ordered units. Technical PASS `0455ceb9` is lineage, not pickup.
- Plan-proven embedded paths are the only completeness exception. A raw
  `inBundle: true` flag cannot bypass ordinary tarball requirements.
- Eddy gap handling stays unchanged: client decline may enter the existing
  standard resolver; service storage rejects the incomplete bundle.
- Embedded lock topology drift uses the existing public `EBROKENLOCK` /
  `shadow-trace-drift` classification; nested `cause` shape is not contracted.
- Internal pinned/linker facts may carry bundle topology; `ResolvedPackage`
  remains unchanged. Existing npm-compatible `LockfileEntry` owns the settled
  `bundleDependencies`/`inBundle` fields under ADR-0335.
- Current protocol remains unchanged. The downstream protocol child serializes
  the complete behavior after this physical topology lands.
