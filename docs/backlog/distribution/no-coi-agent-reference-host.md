---
area: distribution
status: ready
title: Refactor the packed lane's Vite consumer into a connections-only reference host that runs the kit scenario in CI
created: 2026-09-27
why: no in-repo host composes @riftydev/sdk + @riftydev/agent for embedders to copy; the packed proofs that already run sdk + agent + scripted provider are test-shaped and re-derive readiness, apply state, busy and output handling, so every consumer rewrites the same glue and nothing pins the host/rifty boundary
epic: no-coi-agent-host-kit
sources: [ADR-0417, ADR-0420, ADR-0426, ADR-0436, ADR-0489, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [tests/integration/fixtures/workbench-vite-consumer/src/no-coi-project-proof.ts, tests/integration/fixtures/workbench-vite-consumer/src/sandbox-agent-proof.ts, tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts, tests/integration/workbench-packed-consumer.mjs, tests/integration/no-coi-agent-browser-proof.mjs, tools/agent-bench/src/no-coi-page.ts, packages/rifty/README.md]
---

## Context

I8 composes accepted kit capabilities in the existing packed Vite consumer and
uses that exact module in the no-COI benchmark. Current proof modules/benchmark
compose separately. New host policy is only applied-ID selection and explicit
app-source/manifest reconciliation after force; ADR-0489. Existing SDK/agent
semantics keep their accepted evidence. Whole-goal proof runs real packed code.

## Challenge

challenge: 2026-09-30 — clear; independent source-authority/PICKUP review confirms host policy, narrow recipe RED and packed bench smoke. Evidence: reference/agent-reference-host-evidence.md.

## Acceptance

1. The full packed-consumer CI lane runs the same readable `src/host.ts` composition on a page without COOP/COEP or a runtime service worker, with SDK/agent/Workbench resolved only from installed tarballs. Support checks and real boot/snapshot events are visible; library catalog, transport, policy, tool text and transcript reducer remain their existing owners. → I8, scenario 1–3, scenario 9
2. First snapshot applies before supplied sources. The app records only the applied snapshotId in its own namespace/root-specific storage; same-ID reopen calls open and preserves actual edits without refetch. Changed ID forces the new payload. The recipe restores the app's actual post-agent desired manifest/source bytes and invokes explicit installation after apply, preserving manifest/lock and executable agent-added dependencies. No SDK identity gate or merge. → I8, scenario 4
3. On that project, one-entry built-in OpenAI catalog/Pi session edits a /health route, then switches to another model with retained history. Flagged endpoint accepts only string content; outgoing assistant tool_calls retain exact id/name/arguments and tool receipts match tool_call_id. Transcript renders shared reducer output. → I8, scenario 5
4. The same journey runs registry-connected and unconnected: real agent shell installs/executes ms and changes manifest+lock with a connection; otherwise it reports the missing-registry error and continues honestly. Unset policies remain unrestricted. → I8, scenario 6
5. Real agent npm run build produces a Vite dist file and ordered stdout/stderr in the next model request. An overlapping host project mutation/run is typed busy; retry after build succeeds, and the host reads dist/index.html. → I8, scenario 7
6. Another tab opening the same namespace observes waiting and a typed occupied outcome; after closing the holder, retry succeeds. Both underlying deadline identities retain accepted I1 evidence. → I8, scenario 8
7. tools/agent-bench no-COI boots this exact module from a packed consumer and passes an executable scripted-endpoint smoke. Defaults match the reference (unrestricted root,100 calls/600s); optional per-capability policies/text-only entries use this module, explicit measurement limits remain configurable. Existing preview-after-turn baseline remains. → I8
8. SDK README links the host and documents caller-owned snapshot/desired-manifest reconciliation. Host source contains only connections, accepted applied-ID recipe and three allowed helpers: display-only ANSI/CR normalization, trace download, one host-call promise chain. No readiness polls, apply-state strings, busy flag, second reducer, streamFn, prompt/tool text or public composition API. → I8, scenario 9

## Preparation

Reuse accepted SDK/agent evidence for landed semantics (ledger). New private
applied-ID/reconciliation recipe alone needs Contract+RED. Executed baseline:
real producer snapshots → real npm installation → explicit force(new ID) →
unchanged manifest/lock/execution assertions. SDK force is correct; existing
consumer orchestration lacks reconciliation. No nonexistent-host import.

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| nonempty payload × direct apply | typed conflict; existing bytes retained | packed reference journey; accepted SDK controls | → scenario 4 |
| missing registry × agent install | loud missing-registry tool receipt; no invented success | both packed configurations; accepted I9 no-effects controls | → scenario 6 |
| same-Worker overlap × build | busy; explicit retry after settlement works | real held HTTP in build script, host mutation overlap | → scenario 7 |
| native writer contention × second opener | real waiting/occupied then retry after holder close | two actual pages; accepted I1 guard/deadline controls | → scenario 8 |
| force deploy × previous user dependency | desired manifest+lock+executable dependency reconciled | baseline RED; real new snapshot excludes added package | → scenario 4 |

## Out of scope

- Published host/conformance package or new examples directory; declined carriers.
- Agent preview/visual debugging; separate goal. Existing preview proof remains baseline.
- SDK-held snapshot identity, automatic manifest merge, installation gate/rollback.

## Decisions

ready-verdict: 2026-09-30 — Contract+RED @ 2287ff4f0d031aa01f68c89bfe0f86acd99341ac

- 2026-09-30 — Host stores applied ID immediately after successful apply; later supplied files/install always execute, including a reconciliation retry with the same ID. Marker certifies apply only; no transaction/rollback claim.
- 2026-09-30 — Source inputs are app-owned: first-open sources after apply; reopen omits stale initial files; deploy receives persisted real post-agent manifest. No automatic manifest diff/merge.
- 2026-09-30 — Benchmark imports fixture host directly; packing copies both files with their relative paths intact, resolving library imports in consumer/node_modules. No duplicate composition or new package.
- 2026-09-30 — Existing preview packed proof stays; new commands-only reference journey and benchmark smoke extend default CI acceptance.
