---
area: playground
status: ready
title: Run the no-COI e2e lane on Firefox and WebKit (persistent context) by manual dispatch and record the named run's per-engine rows in browsers.md
created: 2026-09-27
why: the no-COI lane is chromium-only in config and CI; a one-off run shows Firefox 150 green (99/100, one version-pinned oracle) and WebKit 26.4 blocked only by Playwright's ephemeral context; without a lane the Firefox column can never show ✅ honestly
epic: browser-support-floor
sources: [ADR-0469, ADR-0007, docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md]
code: [playwright.no-coi.config.ts, tests/no-coi/no-coi-memory-descriptor.spec.ts, .github/workflows/ci-cross-browser.yml]
---

## Context

Finding. `playwright.no-coi.config.ts` projects: `chromium` only; `pnpm test:no-coi` hard-codes `--project=chromium`. Run 2026-09-16 (Playwright 1.60): Chromium 148 100/100 (4.5 min); Firefox 150 99/100 (6.2 min) — the red is `no-coi-memory-descriptor.spec.ts:136` `expect(browser.version()).toBe('148.0.7778.96')` ahead of its behavioral oracle (native `WebAssembly.Memory` descriptor read order), so it also reds on the next Chromium bump; WebKit 26.4 41/100 (20.6 min) — 55 from the ephemeral context having no OPFS root (`getDirectory()` `UnknownError`), product path green under `launchPersistentContext` (`replica-storage` body byte-identical to Chromium; `opfs-reload` bytes survive reload, sync handles closed; the sync-access-handle lock-on-reload hazard did not reproduce), 1 `engine-behavior` (WebKit ignores `COEP: credentialless` — COI oracle half, D-001), 2 timeouts reclassified 2026-09-27 as test-infra: `no-coi-agent-sdk.spec.ts:54` awaits a request only `observeNativeReplicaWrites` (`native-replica-observer.ts:55-69`) sends after a native segment write, which never happens under the memory fallback — no deadline; `no-coi-sandbox-build-loop.spec.ts:2698` spec-side wait, exact site unpinned — class unknown (spec-side); probe P2: the product settles on both engines.

Needed: `firefox` + `webkit` projects; a `context`/`page` fixture on `launchPersistentContext` for WebKit (no per-project Playwright switch exists); the version pin replaced — either `test.info().annotations` with the native-V8 oracle running on all engines, or explicit chromium scoping with its reason (the spec is a deliberate SAB-on-headerless-page oracle; the repo pins reference builds, ADR-0383:48, ADR-0372:24) — decided at pickup, never a version-string pin; a manual-dispatch workflow (no cron, no release trigger — user 2026-09-27), non-gating; the named run's per-engine dated rows → `docs/public/compat/browsers.md`; the agent-sdk wait (`spec:54`) gets a deadline + an assertion naming the missing native write, and the build-loop `:2698` wait is pinned to its spec-side site first; a product red → matrix ❌/⚠ + draft finding, never a fix inside this item (user 2026-09-27). Open: WebKit OPFS contention error name (probe under persistent context). → I5.

## Challenge

challenge: 2026-09-28 — clear; unchanged goal FIT premise and ADR-0469 record-only decision. RDY-8: existing-behavior proof / test infrastructure; prior executed baseline in `docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md`.

## Acceptance

1. Firefox and WebKit execute the existing no-COI suite; WebKit uses an isolated persistent profile per test. → I5
2. Browser builds are annotations, never an assertion that rejects a different engine. → I5
3. Native-write and install/run route waits fail with bounded, named diagnostics. → I5
4. One manual-only non-gating workflow dispatch preserves per-engine reports and build versions; dated named-run rows land in browsers.md. → I5

## Out of scope

Gating PRs on Firefox/WebKit (ADR-0007, ADR-0469); fixing product reds found by the lane; the COI lane (`playground/coi-lane-cross-engine-record`).

## Decisions

- 2026-09-27 — record-only for product reds — user "Только записать"

- 2026-09-28 — pickup: reuse accepted evidence under RDY-8; relevant browser runs plus independent Final+GREEN; no new product promise.
