---
area: distribution
status: ready
title: Run a snapshot-backed Workbench without a browser registry
created: 2026-09-07
why: The public options require a registry URL and first-snapshot rejection schedules a real install.
user_story: As the Tracker plugin-sandbox embedder, I want to run a snapshot-backed workbench without a browser registry, but today the public options require a registry URL and first-snapshot rejection schedules a real install.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, ADR-0398, ADR-0394, ADR-0399]
code: [packages/workbench/src/workbench/internal/workbench-options.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/owner-package-state.ts]
---

## Context

An internal snapshot-only ensure exists, but public first-materialization catches
its unavailable result and constructs deferred install. Public admission must
allow no registry URL, restore the published producer's compatible snapshot,
and start the real installed project with zero registry/Eddy requests. Missing,
corrupt, incompatible or over-limit input fails before guest startup with its
reason when the application policy actually needs that snapshot. An unused
new asset cannot block a valid saved project's default reopen. A later npm/package call cannot escape this mode into a hidden network
install; replay using available exact bytes may work, absent bytes fail loudly.

Registry policy is separate from application policy (goal I8): initial deployment
only is the default, preserving saved state; explicit apply mode is available.
Do not use an untrusted install-stamp miss as proof that no saved project exists.
An incompatible saved tree fails without automatic replacement. The application
policy child owns file conflicts uniformly: no package/dependency-specific
conflict resolver. Compatibility/identity and replay integrity still validate
incoming artifacts; they do not authorize overwriting saved project contents.

Registry-enabled acquisition keeps its current behavior. This is not general offline
network isolation: snapshot/static assets are fetched, and guest application
network behavior is unchanged. Reuse the existing acquisition authority; API
shape is an ADR choice. Cross-boundary proof denies registry egress while
restoring the producer tar.gz and running a real Vite build/dev command.

Scope and user decisions: goal I3. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Reference contract

Goal I3/I8 and original user answers own acquisition/application policy;
ADR-0398 defines the public union and absent capability, ADR-0399 the required
caller-lock companion repair. The original npm/Node Vite build and actual
Rollup WASM42 execution are recorded in
reference/workbench-snapshot-companion-decision.md and
reference/workbench-snapshot-only-evidence.md. Snapshot-only is a host policy;
no npm --offline or general guest-network guarantee is inferred.

Carriers: workbench-snapshot-only-options/acquisition/terminal contracts,
installer-without-registry, npm-shell-without-registry,
installer-companion-frontier and dep-snapshot-companion-producer contracts;
mandatory packed snapshot-only-proof.ts with original npm tarballs and denied
registry/Eddy acquisition. I8's accepted physical rollback cases remain valid
for unchanged transactions.

## Acceptance

1. Public Workbench/Playground snapshot-only configuration requires no registry
   URL, rejects contradictory/executable shapes, and carries an owned closed
   union into the physical owner. Existing omitted-mode registry calls retain
   their observable behavior. → I3, ADR-0398
2. Actual producer artifact admits a fresh project with no registry/Eddy
   construction or requests. When needed, missing, refused, corrupt,
   incompatible, replay-invalid or over-limit snapshots reject with their
   reason before guest startup; failed first admission preserves retry state.
   → I3, ADR-0394
3. Core openProject, companion first-materialization, direct package actor
   requests and caller fallback flags cannot turn snapshot-only into automatic
   install/deferred startup. Existing registry-enabled deferred fallback stays
   available. → I3
4. Explicit real npm install may replay a covered lock/cache with no registry;
   missing required metadata/tarball bytes fail loudly through every overload
   and terminal path, including prefer-online and nested/prefix script entry.
   Configured Eddy without registry rejects before any accelerator effects.
   Existing local npm run/lifecycle/bin behavior remains. → I3, ADR-0023
5. Persistent saved reopen with edited files and an unused changed snapshot
   makes no snapshot/registry request and executes saved content. Missing saved
   trust fails without automatic replacement; explicitly applying the same
   invalid asset fails with all saved bytes retained. → I3, I8, ADR-0394
6. Mandatory packed public Chromium host copies runtime assets, consumes a
   public-producer Vite tar.gz, runs real npm build/dev and renders real output
   with no browser registry URL. Server-side denied registry/Eddy acquisition
   and browser observations stay zero across fresh start, explicit unavailable
   npm request, saved reopen and teardown. Existing registry-enabled Vite/HMR
   journey stays a positive control. → I1, I2, I3, scenario2, scenario4

7. Public producer accepts the original npm Vite/Rollup reference locks through declared same-version companion acquisition. Retained/nested companion permissions remain path-scoped; existing ordinary/companion source pins stay exact and new ordinary child paths remain refused. Installer/Eddy classify the same policy frontier. → I1, I3, ADR-0399

## Parity cases

1. Exact cache replay retains actual installed package bytes and real program
   output; reuse captured Node ms@2.0.0 oracle and existing local npm command
   parity. Snapshot-only itself is host policy, not an npm --offline claim.
   → I3, ADR-0023

2. Real native npm ci and Vite7.3.6 build using the unchanged npm v3 input succeeds; the producer/browser route builds and renders that project under the existing runtime adaptation policy. → I1, I3, ADR-0399

## Fault matrix

| axis × operation | honest outcome / carrier | trace |
|---|---|---|
| corrupt-input × public and owner policy | reject contradictory/executable branch before effects; options/wire carriers | → I3 |
| false-fallback/corrupt-input × needed snapshot | useful public reason, no guest/deferred install, recoverable admission; real owner plus packed public failure | → I3, ADR-0394 |
| provenance-lie × saved trust / unused asset | trust miss retains bytes without acquisition; valid saved tree ignores unused bad asset | → I3, I8 |
| poisoned-cache × explicit local install | required missing/corrupt cache never triggers registry/Eddy; real installer/terminal carriers | → I3, ADR-0023 |
| sibling-drift × alternate automatic/direct/npm entry | owner policy wins all callers; registry-enabled positive control remains | → I3 |
| sibling-drift/provenance-lie × companion projection | installer/Eddy share policy origin; scoped producer permission retains ordinary identities and rejects malformed/missing unrelated edges | → I1, ADR-0399 |

No new storage, FIFO, journal, retry or timeout mechanism. Reuse I8 certified
rollback/physical crash proof for unchanged transactions; new refusal tests
exercise the policy at their existing admission boundary.

## Out of scope

General guest-network isolation, npm --offline semantics, producer-owned private
registry authentication, new package/ordinary-bin compatibility and a new
installer/placement algorithm. I4/I6/I5/I7 remain in the goal map. I8 application
and recovery authorities are preserved; no new storage or timeout mechanism.

## Decisions

- 2026-09-08 — required discovery: ADR-0399 repairs original npm Vite/Rollup companion acquisition and scoped producer permission in this unit; caller-pin protection remains.
- 2026-09-08 — pickup: ADR-0398 selects explicit compatible acquisition union and actual absent registry capability; I8 is accepted; compiled RED preparation awaits independent Contract+RED.

- 2026-09-07 — round 3: compose the separate generic application-policy authority; registry admission never chooses which existing files to overwrite.

- 2026-09-07 — finding draft; observable scope is settled by goal I3; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear

### Re-fit — application and registry policies

challenge: 2026-09-07 — clear
