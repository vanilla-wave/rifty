---
area: process-meta
status: active
title: Documentation debt ledger — ADR/backlog/compat record drift where docs outran code
created: 2026-06-13
why: A cluster of low-effort record-honesty drifts (ADR prose, backlog status, compat narrative, ADR numbering) where the documentation no longer matches shipped code; consolidated into one ledger instead of one tiny backlog file each.
user_story: As a maintainer trusting the records to reflect reality, I want shipped items (`import.meta.url`, `#`-imports field, perf wins) shown as done and stale ADR prose reconciled, but today they still read open/unimplemented and ADR bodies cite phantom files so the docs lie about what code does.
sources: [ADR-0070, ADR-0017, ADR-0090, ADR-0125, ADR-0009, ADR-0030, ADR-0082, docs/adr/README.md]
code: [docs/adr/README.md, packages/runtime-js/src/module-loader/resolver.ts, .github/workflows/release.yml]
---

## Context

Each line is a record that disagrees with the code. Two kinds:
**(E) plain edit** — a backlog/README/features-doc file, fix in place.
**(A) ADR-process** — touches an active (immutable) ADR; reconcile via `docs/adr/README.md` "Historical references" / a superseding ADR, never by rewriting the ADR body.

- **(E) Shipped perf items still `status:active`.** io-bytes-to-string, fssync-statsync-or-null, syncrpc-v2-waitasync-binary-ring, setimmediate-drain-order, cross-realm-dispatchstruct-fast-path, buffer-accessor-dataview-cache, none-items-quick-wins all shipped but read open. Flip to done / point at the real ADR (ADR-0082..ADR-0086).
- **(E) Shipped features marked unimplemented.** `package-json-imports-field` + `import-meta-url` backlog items (and their compat rows) claim unimplemented; both ship (resolver.ts:138 `#`-imports; esm.ts:179 `import.meta.url`) with passing conformance. Correct/close them.
- **(E) ADR README band overstated.** `docs/adr/README.md` Numbering says the provisional 0081–0093 band "materialised … 0082–0093 as ADRs"; only ADR-0082..ADR-0087 exist. Correct to 0082–0087.
- **(E) ADR-number pre-claim collision.** Parked 0048-successor item (`end-to-end-page-worker-readablestream`) pre-claims "ADR-0093", already assigned to the shell parity harness. Drop the pre-claim; let `adr:new` allocate when the supersession is authored.
- **(E) terminal-features.md overclaim.** Reference doc claims in-package exit-code / overview-ruler decorations; `@riftydev/terminal` renders none (host-owned). Correct the doc.
- **(A) ADR-0070 D7 release record.** Records an NPM_TOKEN release; shipped CI is tokenless OIDC (`.github/workflows/release.yml`) whose comments contradict the ADR. IRREVERSIBLE → amend/supersede ADR-0070; the pivot currently lives only in `docs/public/publishing.md`.
- **(A) ADR-0017 scope statement stale.** Claims net is fully-buffered with streaming deferred; streaming body + chunked TE + v2 cross-realm frames shipped. Addendum also cites `adapters/hmr-bridge.ts` (actual path `glue/hmr-bridge.ts`). Superseding note.
- **(A) ADR-0090 mislabel + dangling supersession.** File H1 reads `# ADR 0083` (collides with the active statSyncOrNull ADR); claims to supersede `native-renamesync` but the playground `renamePath` migration was never applied (the impl half stays tracked in `vfs/native-renamesync`). The mislabel/claim is the doc half.
- **(A) Dangling ADR citations.** ADR-0009 cites a nonexistent `esm-ast-walker.ts` + a phantom `acorn-walk` dep; ADR-0030 cites nonexistent `buffer-prototype-core/-int/-extra.ts` + an ADR-0024 line-budget rule (ADR-0024 retired; contradicts the live "no file-size cap"); ADR-0036 cites a stale `realVite.ts`; ADR-0019 cites a stale `installProcessShim` cross-ref and a `host-eval-cwd.test.ts` that does not exist (the missing test is tracked in `process-meta/test-coverage-debt`). Resolve via README provenance; do not rewrite immutable ADR bodies.
- **(E) Moved ADR rationale path.** ADR-0082/0083/0084 cite rationale at the old `docs/perf/` path; the files live at docs/backlog/perf/reference/. The README redirect already resolves it for tooling, but the in-ADR text reads wrong; note it in README provenance and consider extending `refs:check` to lint ADR prose-body paths (overlaps the `refs:check` guard item).
- **(E) Stale "in-realm execBin" prose (pty-server).** `apps/playground/src/workers/pty-server.ts:8,75` still describe in-realm bin exec; P6a wires `createOwnerChildBinExecutor` (a supervised child worker). Correct the comments.
- **(E) Stale FileExplorer header.** `apps/playground/src/components/FileExplorer.tsx:3` says it renders "the main-thread `syncMirror()`"; `App` wires it to `snapshotFs` (the owner snapshot). Correct.
- **(E) Dead `RIFTY_OWNER_MODE` env.** `apps/playground/src/glue/realVite.ts:201` sets `env RIFTY_OWNER_MODE:'shell'` but it is read nowhere; the comment at `apps/playground/src/workers/real-vite-bootstrap.ts:690` implies a branch that no longer exists. Drop the set + the comment (one-line dead-code removal alongside the doc fix).

Excluded from this ledger (NOT doc-only, kept as their own items): `npm-client/esbuild-substitution-strategy-reconciliation` (design/impl fork — 3 substitution mechanisms, ~20MB wasted, contradicts ADR-0027); `service-worker/anonymous-embedded-heuristic-warn-mismatch` (likely a code fix — add the warn); `playground/dev-mode-repl-retirement-dead-code-unrecorded` (dead-code removal); `service-worker/page-proxy-retirement-untracked` (code-retirement follow-up); the compat-matrix coverage (`process-meta/compat-matrix-coverage-debt` — generator code + parity cases); the test-coverage debt (`process-meta/test-coverage-debt`); the `refs:check`/`madge` tooling guards; and the `kernel/resolve-getipcmode-dead-public-surface` code item.

## Options or Next

One PR for all **(E)** edits (backlog statuses, two reclassifications, README band, number pre-claim, features doc) — byte-safe, reversible, no design. The **(A)** records go through the ADR process: ADR-0070 OIDC needs an amending/superseding ADR; ADR-0017/0090/0125/0009/0030/0036/0019 reconcile via the `docs/adr/README.md` "Historical references" table or a superseding note (active ADRs immutable). The missing DataView-cache ADR (IRREVERSIBLE rule4) is its own decision. Optionally extend `refs:check` to lint ADR prose-body doc paths so this class can't rot silently again.

## Reversibility

REVERSIBLE for the **(E)** edits (doc/backlog hygiene). The **(A)** items are IRREVERSIBLE-by-process — each needs an ADR amendment / superseding note, not a body rewrite — and the DataView-cache record needs a new ADR.
