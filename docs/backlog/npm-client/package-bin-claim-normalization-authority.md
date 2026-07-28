---
area: npm-client
status: draft
title: Package-bin claim normalization authority
created: 2026-07-28
why: the terminal claim-preflight checkpoint proved pure current/prior normalization can be specified independently from linker entrypoint mutation ordering
user_story: As a browser-IDE user installing package CLIs, I want one exact claim authority to reject ownership it cannot settle like npm, but today a broadened internal carrier could admit raw or already-shaped data
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-bin-source-normalization-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This was the first split successor to terminal
`npm-client/package-bin-claim-preflight-authority` at
`cbeb4bfe04f270898aa003c04ef8e6edd3daf280`. Its second Contract+RED
checkpoint proved source normalization and cross-source current/prior
settlement are independently reviewable. This item is now a terminal blocked
split predecessor and receives no third checkpoint.

`npm-client/package-bin-source-normalization-authority` now owns one strict
source-to-claims boundary. Then
`npm-client/package-bin-claim-settlement-authority` owns only cross-source
scope settlement. Public, cancellable, and prepared linker integration remains
in `npm-client/package-bin-claim-link-ingress-authority`.

## Reference contract

- The committed Node v24.16.0 / npm 11.17.0 packed-tarball differential proves
  same-command ownership is reify-history-sensitive, not a static comparator.
- ADR-0335 requires current or authoritative-prior ambiguity to throw exactly
  `NotImplementedError('npm-client.bin-collision-reify')`.
- Current input is an existing prepared package. Prior input carries only
  `(package.name/bin, nodeModulesDir)` and never invents files, install paths,
  or output claims.

## Acceptance

- One package-private source type positively admits prepared current packages
  and narrow current/prior facts. Negative type witnesses reject raw
  `ResolvedPackage` and shaped `PackageBinClaim`; no broader union can satisfy
  the real preflight.
- Normalize each supported string/object bin exactly once on success. Every
  reached current/prior collision, transition, removal, and escaping-target
  error reads each reached source at most once.
- Return exact detached `(nodeModulesDir, command, owner, target)` current
  claims. Equal command text in different root/nested scopes remains
  independent.
- Opposite-order same-scope current duplicates, recorded prior collisions,
  owner transitions, and removals throw the exact named ceiling. A stable sole
  owner remains admissible when its target changes and returns only the current
  target.
- Escaping targets reject in pure preflight. No VFS or linker entrypoint enters
  this unit, and no compat claim is made here.

## Parity cases

1. Prepared-current and narrow current/prior positive witnesses compile; raw
   packages and shaped claims remain negative type witnesses.
2. Supported string/object inputs normalize once to exact current claims;
   independent root/nested scopes remain separate.
3. Both current orders plus prior collision, transition, removal, and stable
   target cases match the ADR-0335 ceiling matrix.
4. Every reached rejection source throws on a second read; escaping targets
   reject before a claim is returned.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / observable-order | current/prior ambiguity throws the exact ceiling; no static npm winner | packed npm probe plus opposite-order/prior table |
| corrupt-input | only prepared/narrow sources enter; raw packages, shaped claims, and escaping targets reject | positive/negative type witnesses plus target table |
| sibling-drift | current and prior use one normalization boundary once on success and reached errors | all-branch string/object read-count table |

## Out of scope

- Public, cancellable, or prepared linker invocation, optional prepared-prior
  integration, zero-mutation VFS proof, compat, and the non-colliding floor;
  `npm-client/package-bin-claim-link-ingress-authority` owns them.
- All-files-before-bins ordering, target existence, launcher writing, abort,
  `ENOSPC`, `EACCES`, and retry;
  `npm-client/package-bin-phased-linker-authority` owns them.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock, and
  reporting; `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm's broader array/scoped/key/target normalization differential and malformed
  metadata outcomes; `npm-client/npm-package-bin-normalization-authority` owns
  that outside-goal work. This unit claims only today's supported string/object
  shapes.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `split-predecessor:
  cbeb4bfe04f270898aa003c04ef8e6edd3daf280`; predecessor checkpoints:
  `6fdc19c5b98b9773fa5406126e6ac35c4329b9af` and
  `cbeb4bfe04f270898aa003c04ef8e6edd3daf280`.
- This is the only current JIT Items/Budget selection. Existing Budget rows
  remain append-only; link ingress stays a linked draft until this unit lands.
- The second predecessor blocker is killed by one exact source type: positive
  prepared/narrow inputs and negative raw/output-claim inputs compile against
  the real preflight, never an erased test carrier.
- ADR-0335 and the npm oracle settle the behavior fork: ambiguity throws; no
  comparator or plausible winner ships.
- `contract-red-first:
  880813bf62a85050be44c48694e6560164b5f158`; Standards passed, Spec blocked
  missing string-form rejects, multi-command exactness, and equal-command prior
  scope isolation.
- `terminal-checkpoint:
  acf363bc6f34b7b070e787fad6619d99c3839723` — second Contract+RED BLOCKED;
  this unit receives no third checkpoint.
- `checkpoint-lineage: [880813bf62a85050be44c48694e6560164b5f158,
  acf363bc6f34b7b070e787fad6619d99c3839723]`.
- `split-successors: [npm-client/package-bin-source-normalization-authority,
  npm-client/package-bin-claim-settlement-authority]`.
- Contract+RED @ `acf363bc6f34b7b070e787fad6619d99c3839723`
  blocked exactly: current-only negative type witnesses could admit broadened
  prior sources; equal-owner root/nested prior claims could admit a global
  command index.
- The first successor preserves one strict source list as ordered detached
  claims without settling duplicates. The second composes it for exact
  current/prior inputs and keys settlement by scope plus command. Link ingress
  later proves optional-prior composition against the real prepared entrypoint.
