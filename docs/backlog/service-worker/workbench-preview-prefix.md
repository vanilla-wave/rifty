---
area: service-worker
status: ready
title: Serve Workbench preview inside a host-selected service-worker scope
created: 2026-09-07
why: Fixed root /preview URLs prevent iframe preview under a narrow embedding scope.
user_story: As the Tracker plugin-sandbox embedder, I want to serve workbench preview inside a host-selected service-worker scope, but today fixed root /preview URLs prevent iframe preview under a narrow embedding scope.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, ADR-0409, ADR-0036, ADR-0189, ADR-0263]
code: [packages/io/src/preview-protocol.ts, packages/service-worker/src/preview-bridge.ts, packages/workbench/src/workbench/internal/workbench-options.ts]
---

## Context

The host page can select a narrow SW scope, but preview addressing is fixed to
/preview/<port>. Host-selected prefix must work through actual iframe navigation,
preview assets, root-relative guest requests and HMR, without root scope or
editing the guest project's URLs. Preserve the existing default route for
existing hosts. SW scope must contain both the Workbench page and selected
preview route; malformed/out-of-scope config fails before deployment effects.

Use the existing canonical preview-addressing and owner-binding authorities;
no second URL parser or alternative request dispatcher. ADR must reconcile the
prefix with io/HTTP/WS/iframe consumers. Prove a built packed host under /sandbox/
and copied SW assets, with an unrelated host route outside its scope. Preserve
existing response and owner authorization semantics; scope is not JS isolation.

Scope and user decisions: goal I5. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Reference contract

Accepted goal I5/scenario3 owns non-root iframe/assets/HMR and unchanged guest
source URLs. Existing root addressing and owner/protocol/HTTP behavior remain
baseline. Native Chromium148 probes distinguish controlled subresources from
new out-of-scope navigations and establish immutable SW query configuration
across termination/reload. No arbitrary navigation/redirect rewriting or
mixed published-asset-version promise. ADR-0409 records the chosen public configuration and existing transport route.

## Acceptance

1. Both public entrypoints accept deployment.previewPrefix; one canonical absolute pathname normalization and same-origin SW-scope check runs before lease/registration/Worker/storage effects. Invalid or explicit out-of-scope prefixes reject. Omission preserves /preview/, existing narrow-scope Node-only admission and exact normalized opaque SW URL. → I5, scenario3, ADR-0263
2. Copied static SW receives the selected prefix through its script URL, preserving caller opaque query encoding/order/duplicates/bare values. Reserved collision, duplicate or malformed configuration rejects loudly. Native SW stop/restart and host reload retain the same actual configuration without replay or custom SW compilation. → I5, I2, scenario2/3
3. Existing transferred-port controller proof verifies actual configured prefix alongside current controller/frame/routing versions at boot and preview mount. Wrong-prefix old controller cannot admit a new configuration; pending proof follows correct replacement through existing controllerchange. → I5, ADR-0031, ADR-0040
4. Canonical io addressing drives every registry producer (dev, production preview, generic Node), SW direct matching/referrer recovery and injected WebSocket prefix extraction. Guest HTTP localhost port/path/query and ordinary decimal-port semantics remain unchanged; unrelated host routes remain host-owned. → I5, ADR-0036, ADR-0189, ADR-0278
5. Existing page→net bridge carries optional defaulted prefix through Request and dispatchStruct to real HTML/WS injection. Document-relative WS drops the complete selected prefix; root-relative guest WS paths/query and external native WS retain existing behavior. HTML encoding/headers/length/drain deadlines/idempotence and existing owner refusal remain intact. → I5, ADR-0189, ADR-0040
6. Mandatory packed host at /sandbox/ uses published copied SW inside that non-root scope, snapshot-only and a selected namespace. Real produced Vite dependencies edit/build/dev, initial iframe navigation, absolute guest module/CSS/API and HMR succeed without guest URL edits; HMR preserves the iframe sentinel/no reload. → I1, I2, I3, I4, I5, scenario3
7. Unrelated host documents/API/static files remain exact and outside preview routing. Existing missing/ambiguous/not-ready owner503, controller/version mismatch and preview-client admission protections remain effective with a configured prefix. → I5, scenario3, ADR-0160
8. Existing default root packed journeys and root-prefix callers remain valid; docs describe copied script/query serving, scope containment and configured public API, with no root SW allowance hidden in the non-root acceptance fixture. → I2, I5, scenario2/3

## Parity tests

1. Native Chromium SW scope/query/controller/restart behavior is the deployment oracle; real browser execution of unchanged Vite HTTP/WS sources proves routing. Native configuration-only probes do not close packed product acceptance. → I5
2. Existing HTTP body/status/header and generic WebSocket bridge semantics retain their prior real Node/native controls; no new framework compatibility or root-navigation rewrite promise. → I5, ADR-0189

## Fault matrix

| axis × operation | honest outcome / carrier | trace |
|---|---|---|
| corrupt-input × options/script-query/route | one canonical normalization; bad type/path/scope/duplicate/collision rejects before deployment or routing | → I5, ADR-0263 |
| sibling-drift × registry/SW/referrer/HTTP/WS | one io pathname authority; all producers and two net request paths use same captured prefix | → I5, ADR-0036 |
| poisoned-cache/provenance-lie × SW controller config | actual PONG prefix must match, never page-request echo; stale controller cannot prove replacement | → I5, ADR-0031, ADR-0040 |
| torn-state × SW update/restart/reload | immutable script URL restores prefix; existing controllerchange/proof handles replacement, no replay map | → I5 |
| observable-order × invalid config/preview readiness | no deployment effects before validation; existing proof deadline and owner dispatch ordering | → I5, ADR-0263 |
| concurrent-same-key × shared port/owner | existing bindings reject ambiguity and preserve admitted owner; configured prefix adds no coordinator | → I5, ADR-0160 |
| false-fallback × unrelated host/referrer/WS | unrelated host routes stay native; no root routing or guest rewrite fallback | → I5, scenario3 |
| unbounded-read × HTML response/proof | existing HTML drain and control deadlines retained; no added read or retry loop | → I5, ADR-0189 |

## Out of scope

Arbitrary out-of-scope document navigation/redirect rewriting, changed Vite base,
root SW scope, custom host Worker compilation, multiple prefix configs within a
single SW registration, new owner arbitration/retry, mixed-version asset support,
broader service-worker lifecycle backlog. I7 effective budgets remains on map.

## Decisions

- ready-verdict: 2026-09-09 — Contract+RED @ 8df45fadbff842794142761ea78bc4adb5865522; reference/workbench-preview-prefix-contract-red.json.

- 2026-09-09 — pickup: ADR-0409 captures one immutable prefix via static SW URL and existing owner/PONG/net frames; native query/scope probes and RED carriers in reference/workbench-preview-prefix-pickup.md and reference/workbench-preview-prefix-evidence.md. Contract+RED remains before implementation.

- 2026-09-07 — finding draft; observable scope is settled by goal I5; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
