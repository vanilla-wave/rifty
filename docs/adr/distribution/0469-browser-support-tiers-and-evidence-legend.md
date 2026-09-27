# ADR 0469: Browser support tiers and evidence legend

Status: Accepted
Date: 2026-09-27

> TL;DR: three evidence-defined support tiers refine D-006 — Chromium supported (gating), Firefox verified (manual dispatch, non-gating, no schedule), WebKit capability-verified (lane partial) — and one legend governs `docs/public/compat/browsers.md`: every cell names its evidence, no ✅ without an executed run.

## Context

`AGENTS.md` §Mission listed "non-Chromium browsers" among non-goals; ADR-0007 (D-006) says Firefox/WebKit are best-effort with 3-engine Playwright infra. Neither names a minimum version; the declared bundle target is `es2022` while shipped workers use ES2023 builtins (`toSorted`); `ci-cross-browser.yml` never produced a recorded result. A host asking "which share of devices runs the sandbox, COI or non-COI" met two contradicting scope docs and no dated evidence.

Evidence, 2026-09 (`docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md`, `docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md`):
- computed floors (BCD 8.0.13 + shipped-bundle scan): non-COI Chrome 110 (`toSorted`; 108 once the sites are rewritten — next binding is the sync OPFS handle methods; Android 109) / Firefox 115 (`toSorted`; 114 after — module workers) / Safari 26 (`createWritable`); COI adds Firefox 145 (`Atomics.waitAsync`, probe requires it) and excludes WebKit by D-001 `COEP: credentialless` (WebKit ignores it; `require-corp` yields COI+SAB on all three engines);
- executed, Playwright 1.60 bundles, no-COI lane: Chromium 148 100/100; Firefox 150 99/100 (the red is a version-pinned oracle, test-infra); WebKit 26.4 41/100 — 55 from Playwright's ephemeral context having no OPFS root (`checkSandboxSupport` there: nonCoi unmet `["opfs"]`); two persistence flows (`replica-storage`, `opfs-reload`) re-run green under a persistent context, the other 57 specs unobserved; the feared sync-access-handle lock-on-reload hazard did not reproduce;
- the research's share numbers (≈ 96.7 % global / 97.8 % RU able among admitted) are ratios over that external host's browserslist resolve, not rifty's; rifty's share uses all tracked traffic as denominator (caniuse-lite usage, global and RU; RU coverage ≈ 67 %, Yandex Browser absent — StatCounter cross-check as caveat) and is computed at the matrix slice.
- `opfs` is required only under `persistence: 'required'` (`packages/workbench/src/support/report.ts:71`); the default `'preferred'` falls back to memory when OPFS init fails (ADR-0372) — but a realm with sync handles and no `createWritable` passes detection, selects OPFS and loses data (probe P1); once gated, the Safari floor differs by persistence: ephemeral 16.4 (computed), persistent 26.

## Decision

- Tiers are defined by evidence per engine, never by a promise to fix:
  - **supported** — Chromium: gating CI lanes; a regression blocks merge.
  - **verified** — Firefox: cross-engine lanes run by manual dispatch, non-gating, no schedule and no release gate (user 2026-09-27); a product regression is recorded (matrix ❌/⚠ with its class + a backlog finding), fixed best-effort, never blocks a PR (ADR-0007 "will not block PRs" stands).
  - **capability-verified** — WebKit: the required APIs are present in the module-worker realm (spot-checked) and targeted product flows ran green under a persistent context; `checkSandboxSupport` under a persistent context and the full lane are pending; cells say exactly what ran (⚠/⚙ with the run).
- One legend, normative for `docs/public/compat/browsers.md` and overriding the `docs/public/compat/README.md` legend for that file: `N` computed floor (binding API named, BCD); `✅N` lane executed on build N (date + named run); `⚠N` lane executed on N with recorded product reds (classes listed); `⚙N` capability probe passed on N, lane not run; `❌` unsupported (reason); `❓` not characterized. A cell without an executed run never shows ✅ or ⚠.
- Floors are stated per mode (COI, non-COI) × persistence (ephemeral, persistent) × engine column with the binding requirement; non-version cut-offs (secure context, CSP, private modes, Lockdown, eviction, memory) are rows of their own; traffic share is a dated ratio (versions ≥ floor / all tracked traffic, global and RU) with method and caveats — never a host's browserslist, never `browserslist defaults` (it drops exactly the versions below the floor).
- `AGENTS.md` §Mission reads "non-Chromium browsers beyond the measured tiers (ADR-0469)"; ADR-0007 stays, §Corrections points here.
- A computed floor moves with executed evidence or with a landed change plus its guard/test (the `toSorted` rewrite, the `createWritable` gate). Under the default `persistence: 'preferred'` a realm lacking `createWritable` runs memory-backed with the reason exposed (existing ADR-0372 fallback; user 2026-09-27 "1a"); under `'required'` it is refused at boot. Levers that would widen a floor beyond that (Safari <26 persistent via sync-access-handle writes — `vfs/safari-pre-26-replica-without-createwritable`; COI on WebKit via `require-corp` — `distribution/coi-on-webkit-require-corp`; Firefox 119–144 COI via an `Atomics.waitAsync` polyfill — `kernel/firefox-pre-145-coi-waitasync-polyfill`) are backlog questions, not tiers (user 2026-09-27 "2a").
- Shipped ES floor is ES2022 (the declared bundle target): the nine unconditional `Array.prototype.toSorted` sites and the playground's `findLast` are rewritten behavior-identically (user 2026-09-27 "a": Chrome 108–109 = 0.890 % global / 3.440 % RU of all tracked traffic, caniuse-lite 1.0.30001793, computation in the research evidence appendix; 109 = last Chrome for Windows 7/8.1); floors after the rewrite: Chrome/Edge 108 (sync OPFS handle methods), Chrome Android 109 (OPFS family), Opera 94, Firefox 114 (module workers; ESR 115 is the population, 114 ≈ 0.008 % RU); a guard refuses unconditional ES2023+ builtins/syntax in shipped bundles; feature-detected uses are allowlisted by name (today `Atomics.waitAsync`: `packages/kernel/src/ipc/capabilities.ts`, `ipc/sab-ring.ts`, `worker-stdio-drain.ts`, `packages/workbench/src/support/check-sandbox-support.ts`, `support-worker.ts`).

## Alternatives

- Matrix only, scope docs untouched: cheaper by an ADR; leaves AGENTS.md vs ADR-0007 contradicting — rejected by the user 2026-09-27.
- Gate PRs on Firefox/WebKit: violates ADR-0007 and doubles CI time for a non-supported tier — rejected.
- Generated matrix from caniuse-lite + BCD deps: two new deps for numbers that move a few times a year — rejected (Simplicity); hand-maintained, dated, method recorded.
- Keep ES2023 and the Chrome 110 floor: rejected by the user ("a") — the rewrite is nine behavior-identical sites and Chrome 108–109 is 3.4 % of RU traffic, more than the Safari <26 band.

## Consequences

- "Which devices run it" is answered by a dated table, not an argument; a stale cell is visible by its date.
- Cross-engine reds from a dispatched run become recorded findings — bounded triage load (record-only); nothing runs on a schedule.
- Follow-ups: epic `docs/backlog/epics/browser-support-floor/`.
