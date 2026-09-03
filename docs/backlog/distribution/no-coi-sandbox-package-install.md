---
area: distribution
status: ready
title: no-COI public sandbox exact-manifest package install proof
created: 2026-09-02
epic: no-coi-sandbox-tier
why: the public no-COI install path is green, but Final review did not execute the frozen npm bounds, required-failure and same-key-concurrency evidence that supports the real Vite 7 dependency-set install
user_story: As an agent on a headerless page, I want one exact project manifest installed through the ordinary npm authority, with the installed tree and inherited failure bounds proven rather than inferred from a later successful build
sources: [ADR-0371, ADR-0376, docs/backlog/distribution/reference/no-coi-build-spike-record.md, docs/backlog/distribution/reference/no-coi-sandbox-package-install-evidence.md, distribution/no-coi-sandbox-build-loop]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/npm-client/src/registry.fault.test.ts, packages/npm-client/src/installer-concurrency.test.ts, packages/npm-client/src/internal/shadow/installer.contract.test.ts, packages/workbench/src/workers/owner-package-runtime-bindings.contract.test.ts, packages/workbench/src/workers/workbench-runtime-adapters.contract.test.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
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

Upstream: certified public admission and ADR-0376 lifecycle. Downstream:
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
  same-key dedupe. ADR-0376 Decision 2 delegates exact-manifest install to that
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
   → I2
2. One frozen focused npm command executes the existing bounded-read,
   required-fetch-failure, corrupt registry-twin and concurrent same-key
   acquisition cases, quoting tool versions and selected case names/counts.
   The SDK layer adds no cache, retry, semaphore or registry authority.
   → I2, ADR-0371
3. Successful install exposes one exact installed tree only after existing
   finalization, runtime binding activation and VFS flush. A required
   acquisition/integrity failure rejects without an adapter-success claim.
   → I2, ADR-0371

## Parity cases

1. Frozen Vite 7 project: public no-COI install and the current COI product use
   one dependency digest and expose the same exact direct installed versions.
   Artifact: package-install evidence §Public install. → I2
2. npm inheritance: named existing cases pin byte bounds, required fetch
   rejection, corrupt-twin rejection and one concurrent same-key acquisition.
   Artifact: package-install evidence §npm faults. → I2, ADR-0371

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` + `frozen-assumption` × installed tree | exact direct versions and attested runtime from Worker VFS | frozen public fixture → I2 |
| `unbounded-read` + `poisoned-cache` × registry acquisition | inherited bounds/integrity; required/corrupt input rejects | frozen 13-case npm command → ADR-0371 |
| `concurrent-same-key` × package acquisition | inherited one acquisition/deduplicated result, no sandbox queue | npm concurrency carrier → ADR-0371 |

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

ready-verdict: 2026-09-03 — Contract+RED @ 5a26cfa2a
review: checkpoints rounds:2
re-cut: 2026-09-03 — split successor of distribution/no-coi-sandbox-build-loop for the I2 package-install proof HOLD — trace: none
- 2026-09-03 — owns frozen public install plus npm bounds/required-failure/same-key evidence; Vite-8/nanoid execution stays I3.
- 2026-09-03 — expected RED band is 0–0: existing certified carriers are selected exactly; product/tests unchanged.
