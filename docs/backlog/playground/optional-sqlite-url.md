---
area: playground
status: ready
title: Make Workbench SQLite deployment optional
created: 2026-09-10
why: Vite-only embedders must not host an unused SQLite WASM asset
sources: ["https://github.com/vanilla-wave/rifty/issues/281"]
---

## Challenge

challenge: 2026-09-10 — clear; sqlite_decision checked existing lazy engine and asset delivery; no alternate transport required.

## User scenario

Issue #281 and the user's implementation handoff: open Workbench without
`deployment.wasm.sqlite` or all of `deployment.wasm`, restore a Vite snapshot,
run ordinary Node and `vite build`/dev. No SQLite WASM deployment or request.
SQLite use without configuration fails naming the missing option; supplied
valid URLs retain actual SQLite. Supplied empty/malformed values fail validation.
Recursive workers retain the host's absence even with replacement guest env.

## Acceptance

1. Omitted wasm/sqlite accepted; supplied malformed objects/URLs rejected by public validation. `sqlite-options.test.ts`. → scenario
2. Packed snapshot-only Vite build/dev/HMR and ordinary Node run with no configured or deployed SQLite; recursive execSync, worker_threads and dev-server use report missing `deployment.wasm.sqlite`. `sqlite-omission-proof.ts`, packed consumer. → scenario
3. Configured packed SQLite still executes real CREATE/INSERT/SELECT; provider remains lazy and preserves exact URL. Packed consumer, `sqlite-wasm-provider.fault.test.ts`. → scenario
4. Host snapshot serializers preserve absence, required/unknown fields stay strict; prior Node/dev-server protocol versions rejected. Runtime config suites. → ADR-0267, ADR-0416

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| absent asset × boot/build | success, zero SQLite requests | packed consumer removes asset before fresh context | → scenario |
| absent URL × SQLite use in child/recursive/dev-server | missing option error, no guest-env fallback | sqlite-omission-proof.ts | → scenario |
| supplied invalid URL/object × admission | reject before startup | sqlite-options.test.ts | → scenario |
| missing/extra host fields or old protocol × decode | reject; optional SQLite alone accepted | runtime-config/owner-protocol suites | → ADR-0267, ADR-0416 |

## Out of scope

Builtin removal, engine replacement, persistence and bytes API. Existing SQLite
unsupported operations keep their loud throws and compat entries (ADR-0065).

## Decisions

ready-verdict: 2026-09-10 — Contract+RED @ 18ffa13020f531b1031e9ccf639e7867b8f1f9e1

- User authority: #281 + implementation handoff; explicit optionality, strict supplied values, unchanged configured behavior. No new observable policy fork.
- ADR-0416; independent DEC-2 check sqlite_decision, 2026-09-10.
- Evidence: reference/optional-sqlite-url-evidence.md; new host option behavior has no real-Node option oracle.
