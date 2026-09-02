---
area: distribution
status: draft
title: no-COI public sandbox exact-manifest package install proof
created: 2026-09-02
epic: no-coi-sandbox-tier
blocked_by: [distribution/no-coi-public-toolchain-admission, distribution/no-coi-toolchain-operation-lifecycle]
why: the public no-COI install path is green, but Final review did not execute the frozen npm bounds, required-failure and same-key-concurrency evidence that supports the real Vite 7 dependency-set install
user_story: As an agent on a headerless page, I want one exact project manifest installed through the ordinary npm authority, with the installed tree and inherited failure bounds proven rather than inferred from a later successful build
sources: [ADR-0371, ADR-0375, docs/backlog/distribution/reference/no-coi-build-spike-record.md, distribution/no-coi-sandbox-build-loop]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/npm-client/src/internal/shadow/installer.contract.test.ts, packages/workbench/src/workers/owner-package-runtime-bindings.contract.test.ts, packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop` at binding Final
stop `e5347179f`; the predecessor preserves its complete pre-demotion contract
and lineage. This child owns frozen goal I2 only: a real exact-manifest install
through the public no-COI sandbox plus the evidence inherited from npm-client.

It owns one current HOLD: the frozen npm evidence did not select the existing
bounds, required-failure and same-key-concurrency carriers. Exact Vite 8/nanoid
installed-bin fixture provenance belongs to I3, not this I2 contract. The
earlier demand to inject registry faults through the public SDK was adjudicated
STRETCH and is not restored.

Upstream: `distribution/no-coi-public-toolchain-admission` through
`distribution/no-coi-toolchain-operation-lifecycle`. Downstream:
`distribution/no-coi-sandbox-build-loop`,
`distribution/no-coi-host-posture-preservation` and
`distribution/no-coi-dev-hmr-restore`.

Vite 7 is the I2 proof fixture only. Product and infrastructure install
authority reads the caller's exact manifest; it never branches on package
name, version, path, callback, type or lifecycle.

## Challenge

challenge: 2026-09-02 — clear

## User scenario

In the admitted public headerless sandbox, an agent writes the frozen real
Vite 7 project manifest and calls `toolchain.install({cwd,registryUrl})`.
Install settles successfully, and the agent can read the exact installed
dependency identities and required esbuild runtime from the same Worker VFS.

## Reference contract

- Goal I2 requires the real Vite 7 dependency set to install inside the
  sandbox. The durable spike and frozen scenario pin its direct versions.
- ADR-0371 owns registry-twin bytes, integrity, bounded acquisition and
  same-key dedupe. ADR-0375 Decision 2 delegates exact-manifest install to that
  ordinary npm-client path.
- The shared lifecycle predecessor owns request admission/settlement; this
  child owns the installed tree and npm evidence only.
- Final review at `c2b13d0f3` found the evidence-selection gap. Existing
  successful build output cannot substitute for the inherited npm proof.

## Acceptance

1. The public no-COI sandbox installs the frozen real Vite 7 project manifest
   through the configured registry. Every direct dependency has its exact
   manifest version in the same Worker VFS; the admitted
   `esbuild-wasm@0.28.0` runtime and registry-twin attestation are exact.
2. One frozen focused npm command executes the existing bounded-read,
   required-fetch-failure, corrupt registry-twin and concurrent same-key
   acquisition cases, quoting tool versions and selected case names/counts.
   The SDK layer adds no cache, retry, semaphore or registry authority.
3. Successful install exposes one exact installed tree only after existing
   finalization, runtime binding activation and VFS flush. A required
   acquisition/integrity failure rejects without an adapter-success claim.

## Parity cases

1. Frozen Vite 7 project: public no-COI install vs the current COI product use
   one dependency digest and expose the same exact direct installed versions.
2. npm inheritance: named existing cases pin byte bounds, required fetch
   rejection, corrupt-twin rejection and one concurrent same-key acquisition.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` + `frozen-assumption` × installed tree | read exact direct manifest versions and attested runtime from the Worker VFS | Acceptance/Parity 1/1; frozen Vite-7 dependency fixture |
| `unbounded-read` + `poisoned-cache` × registry acquisition | inherited byte bounds/integrity; required/corrupt input rejects without success | Acceptance/Parity 2-3/2; frozen named npm cases |
| `concurrent-same-key` × package acquisition | inherited one acquisition/deduplicated result, not a new sandbox queue | Acceptance/Parity 2/2; existing npm concurrency carrier |

## Out of scope

- No installed-bin execution result, build module line, dist parity or
  threaded-WASM outcome; the I3 child owns them.
- No public injection of registry faults; that Final demand was STRETCH.
- No admission/report/Worker-topology or operation lifecycle proof; certified
  predecessors own them.
- No Vite identity, version, path, callback, type or lifecycle in product or
  infrastructure authority. Vite 7's exact values belong only to the I2 proof;
  Vite 8/nanoid fixture provenance belongs to I3.
- No new cache, retry, queue, lock, registry default or network source.
- No host-posture, dev/HMR, restart or durability behavior.

## Decisions

review: checkpoints — real network/package evidence for I2.

predecessor: `distribution/no-coi-sandbox-build-loop`

- Owns Final HOLD: frozen npm bounds/required-failure/same-key-concurrency
  evidence. Exact Vite-8/nanoid installed-bin identities stay with I3.
- Dependency direction: public admission → shared lifecycle → this install
  proof → I3 build; host posture and dev-HMR remain downstream.
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `ready-verdict: 2026-09-01 — Contract+RED @ ead27000f`
- `final-green: 2026-09-01 — blocker @ a909a38a9`
- `final-green: 2026-09-01 — blocker @ 6f86d2e7f`
- Bounded-cause split successor certified Final+GREEN at `40ded4758`.
- `ready-verdict: 2026-09-01 — Contract+RED @ df3cc811d`
- `final-green: 2026-09-02 — blocker @ 01465c6ae`
- Descriptor split successor certified Final+GREEN at `dce86792d`.
- `contract-red: 2026-09-02 — blocker @ 41d63c086`
- `ready-verdict: 2026-09-02 — Contract+RED @ 15dbca164`
- `final-green: 2026-09-02 — blocker @ c2b13d0f3`
- Count lineage: `07d370651`/`bcff49986`/`541c4cd6c` counts are unavailable;
  counted Final rounds are `1@a909a38a9 → 1@6f86d2e7f` (stop, bounded child
  PASS), `1@01465c6ae` (carried stop, descriptor child PASS), then
  `15@c2b13d0f3`; latest `1→15` fired convergence. Contract continuation was
  `1@41d63c086 → PASS@15dbca164`.
- Binding stop is recorded at `e5347179f`. Its PR-body band HOLD was already
  fixed in draft PR 294 and is excluded from this child's one current HOLD.
