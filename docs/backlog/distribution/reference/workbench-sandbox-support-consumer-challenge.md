# Challenge record: consumer-fit amendment of `checkSandboxSupport`

Date: 2026-09-15. Item: `docs/backlog/distribution/workbench-sandbox-support-consumer-fit.md`.
Input: `workbench-sandbox-support-consumer-evidence.md`. Branch refs = PR #340
head `f63da13f9`.

## Driver facts before the critic

- SDK non-COI composition uses no Web Locks: `navigator.locks` appears only in
  `packages/workbench/src/workbench/open-workbench.ts` and
  `packages/workbench/src/workbench/internal/browser-workbench-composition.ts`
  (COI); none in `packages/rifty/src/sandbox.ts` or
  `packages/workbench/src/workers/no-coi-toolchain-worker.ts`.
- Finding B reproduces in source: only `module-worker` and the two SW rows get
  "provide probeBaseUrl" (`check-sandbox-support.ts:399-411`); eight other
  asset-dependent rows keep the seed "operation not completed" (`:55`).
- `reasons`/`limitations` are strings; surfaced reasons at
  `check-sandbox-support.ts:168, 247, 330` and `:320` do not start with the check id
  (`:99` is `not-applicable` and never surfaces).
- Non-COI WASM users: `node:sqlite` (`packages/net/src/sqlite/engine.ts`),
  `vmEngine: 'quickjs'` (`packages/runtime-js/src/builtins/vm/quickjs-*.ts`),
  WASI (`packages/runtime-wasi/src/*`); the toolchain worker itself loads none.

## Fresh read-only premise critic (subagent, verbatim)

Premise challenge — `checkSandboxSupport` consumer feedback (PR #340). Read-only; no files touched. Branch refs below = `origin/t3code/workbench-sandbox-support-details` (B).

### 1. Value / cheaper route per F1–F4

**F1 omitted `probeBaseUrl`.** Consumer's stated need = distinguish "not configured" from "not completed". Cheaper direct route is (b): seed the asset-dependent rows' reason from `base === undefined` at B:`packages/workbench/src/support/check-sandbox-support.ts:52-57` — no ADR/guide/test change; stays inside ADR-0437 §2 (B:`docs/adr/distribution/0437-…md:22-23`), guide (B:`docs/public/sandbox-support.md:40`), test (B:`tests/browser-unit/sandbox-support.spec.ts:129-136`). (a) does carry extra value beyond the stated need: a call without `probeBaseUrl` can never reach `supported` (spec:134-135), so the omission branch (:36, :177, :399-411, default `= {}` :19-20) is a no-value path; throwing matches the existing option-validation style (:22-33, :47-49) and removes a permanent "misconfig" cause from the `inconclusive` space, which simplifies any gate. Cost of (a): DEC-2 §Corrections on ADR-0437 §2, rewrite spec:129-136, guide:40-41, `types.ts:39`. Either resolves B; see §4 P3 for a correctness detail (b) must include.

**F2 consumer's own Web Lock.** Re-verified: `navigator.locks.request` only in B:`packages/workbench/src/workbench/internal/browser-workbench-composition.ts:29` and B:`packages/workbench/src/workbench/open-workbench.ts:657` (COI); none in B:`packages/rifty/src/sandbox.ts`. Adding `page-locks` to nonCoi.required would contradict ADR-0437 §3 ("Requiredness follows existing composition operations", ADR:28). (a) no API change + guide snippet composing `checks` `page-locks` is the direct route; value follows. (b) `require:` is a preferred extra feature (Simplicity/REV-7), not needed — consumer filters `checks` by id today.

**F3 SW rows under `skipServiceWorker`.** Premise partly wrong — see §4 P1: the SDK non-COI composition DOES register a module SW by default (B:`packages/service-worker/src/register.ts:38-41` `type: options?.type ?? 'module'`; B:`packages/rifty/src/sandbox.ts:676-685` calls `registerServiceWorker(url)` with no type, swallows failure into `swError`). COI registers classic (`open-workbench.ts:194-196` → `browser-workbench-composition.ts:37`, no type). So `report.ts:63` (coi: classic required) and `report.ts:82` (nonCoi: module optional) mirror real compositions exactly; the module-SW probe is not dead machinery. For the consumer (SW skipped) rows are irrelevant but `nonCoi.limitations` was `[]` in their run (only failed optionals surface, `report.ts:94-102`); noise appears only in `checks` or when SW fails. (b) keep + filter is zero-cost once F4 gives ids. (a) `serviceWorker: false` mirrors the existing `skipServiceWorker` option (`sandbox.ts:51`) and would also skip the transient SW registration; carrier wrinkle: openWorkbench has no skip (`open-workbench.ts:194` unconditional) and `not-applicable` counts as unmet in `summarize` (`report.ts:71-73`), so the option would be nonCoi-only.

**F4 `reasons`/`limitations`.** Confirmed: surfaced non-passed reasons without id prefix at `check-sandbox-support.ts:168, 247, 320, 330` (`report.ts:37` and `:419` do prefix). Guide never promises a prefix (`sandbox-support.md:53`). Cheaper direct route already exists: `conclusion` + `checks.filter(c => mode.required.includes(c.id) && c.status !== 'passed')` — `reasons` merely duplicates `checks` (`report.ts:92`). Pre-merge (a) is fine and agent-owned; minimal-interface variant is `SandboxSupportCheckId[]` (ids only, look up in `checks`) rather than copying check objects. Tests using `.join(' ')` (spec:184, 198, 503, 517) change either way.

### 2. Omitted material user choices (RDY-6 §Establishing scope)

None found. Walked: gate on `inconclusive` (three-valued conclusion settled by ADR-0437 §1:19-20 + refine table B:`docs/backlog/distribution/reference/workbench-sandbox-support-refine.md:104`, Fidelity-derived); transient private SW registration on a no-SW origin (inside Round 3 consent "temporary Worker/test data with cleanup", refine.md:10; cleanup asserted spec:115-124); repeated calls with live session (spec:409-447, consumer §3); `persistence`/`wasm` defaults (`types.ts:40-45`, pickup B:`…/workbench-sandbox-support-pickup.md:16`); Safari/Firefox (ADR-0007 D-006, `docs/adr/playground/0007-browser-support.md:6`). Consumer's open question "when must I set `wasm: true`" answers from `types.ts:44` + pickup:16 (QuickJS engine or WASI/esbuild/SQLite workloads) — docs ride-along, not a choice.

### 3. Forks that are not user-observable scope / already settled

All four are API-signature/carrier decisions. Refine explicitly delegated "public signature, probe URLs/worker carrier, per-mode requirement inventory" to PICKUP (refine.md:106-108); `docs/process/rules/readiness.md:96` ("user owns observable scope; agent owns carriers") and `:112` ("never manufacture scope"); `docs/backlog/README.md:79-80` (preferred extra feature ≠ omitted choice). Public-API change = IRREVERSIBLE → ADR, agent decides/records/continues (CLAUDE.md §Decisions; `docs/process/rules/decisions.md:12, 26-34`).
- F1: settled by ADR-0437 §2 (ADR:22-23), guide:40-41, spec:129-136 → agent-owned DEC-2 correction if (a).
- F2: settled by code (no locks in SDK path, cites above) + ADR-0437 §3:28.
- F3: settled by ADR-0437 §3:28 + §4:31-33 mapping to real compositions (`register.ts:40`, `sandbox.ts:677`); option (a) is an agent carrier decision.
- F4: ADR-0437 §1:17-20 pins report sections, not `reasons` element type → agent-owned.
Reporting recommendations to the user in the refine report is fine; framing them as user forks (STOP-1a) is not.

### 4. Verdict

`challenge: 2026-09-15 — 3 problems`
- P1 Driver fact "no composition registers a module SW" is false: SDK toolchain/non-COI default registers `type: 'module'` (B:`packages/service-worker/src/register.ts:40`, B:`packages/rifty/src/sandbox.ts:677`); `report.ts:82` is correct; consumer's C sub-claim holds only for `skipServiceWorker` hosts — do not drop/relabel the module-SW row on that premise.
- P2 F1–F4 presented as user forks are agent-owned API/carrier decisions (refine.md:106-108; readiness.md:96, :112); F1 additionally already settled by ADR-0437 §2 + spec:129-136 + guide:40 — resolve via DEC-2/ADR, not a user stop.
- P3 F1(b) as scoped ("uniform reason on 11 rows" by extending `:400-404`) is incomplete: the 8 never-started rows keep the seed at `:52-57`, and the deadline rewrite at `:414-422` turns them into "probe deadline expired; operation and cause not established" when `page-locks` alone stalls with `probeBaseUrl` omitted — a lie about operations never attempted. Fix at the seed (or take (a), which deletes the branch).

## Driver reception (REV-12)

- P1 HOLDS: verified `register.ts:38-41`, `sandbox.ts:677`. Module-SW probe stays; the
  2026-09-15 inline review claim is withdrawn.
- P2 HOLDS: no user interview; decisions recorded in the item (`## Decisions`).
- P3 HOLDS: F1 resolved by (a), which deletes the omission branch.

## Final check (RDY-6 §Final check of the written result)

Reviewed revision: `f63da13f9` + uncommitted drafts. Reviewer: fresh read-only
subagent (depth 1). Verified against cited sources: module-SW default, no Web
Locks on the SDK non-COI path, seed/relabel lines, required sets, ADR-0437:23
sentence, spec lines, consumer numbers, no sensitive data. Omitted or silently
decided user choices: none. Attribution: honest draft, no user authority claimed.

`final-check: 2026-09-15 — 6 problems` (all transcription; fixed in place, no
new clean-context pass required per RDY-6):
- P1 omission-branch range `:397-409` → `:399-411`.
- P2 `:99` never surfaces in `reasons`/`limitations`; keep `:168, :247, :320, :330`.
- P3 `why:` said three guide gaps; four are listed.
- P4 "Chromium-only (ADR-0007)" misstated ADR-0007 (best-effort); authority is the
  mission non-goal.
- P5 "inline review claim" had no recorded source; it is the in-session remark
  carried only by consumer evidence lines 115-117.
- P6 `unmet` pinned in Acceptance 2 but left open in Decision D.
Advisory, applied: Acceptance 1 now names guide `:40-41` and `types.ts:39` as made
false; Decisions note the inherited fault matrix (no new axis) and that DEC-2's
decision subagent runs at PICKUP (the premise critic is evidence, not that check).
