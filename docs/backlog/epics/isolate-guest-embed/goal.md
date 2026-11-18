---
kind: epic
status: draft
title: Isolate guest export — rifty's isolate guest bundle and bridge contract as a public unstable package for custom embedders
created: 2026-11-18
value: A Node service with its own isolated-vm 7.0.2 and its own process topology runs rifty guests node -e-faithfully from a public export, without rifty's isolate host.
user_story: As a Node service that embeds V8 isolates itself, I want rifty's guest runtime and its bridge contract as a public export, but today the bundle and bridge live inside `@riftydev/isolate-host` behind `runCode` only
tier: works
---

## Outcome

User's words (2026-11-18, via the thread manager): «Давай пойдем в C и сразу
сделаем экспорт чистого rifty для кастомных интегарций. Ничего страшного, что
контракт будет меняться».

Manager's interpretation (shown to the user, no answer yet): «экспорт чистого
rifty» = the guest bundle plus the bridge contract as the public embeddable
form; «контракт будет меняться» = the export is marked unstable. «C» (worker
pool) is a separate goal, not this one.

A consumer embeds rifty in its own isolate — its own isolated-vm, its own
process topology — from a public rifty package, without rifty's host. The
contract is written embedder-neutral, but proven only on isolated-vm 7.0.2 (the
version rifty's host ships); isolated-vm 6.2.0 lacks two hooks the contract
needs (probe below) and any other embedder is untested — both declared
ceilings (README + compat ⚠️), not supported claims.

The package gives the guest bundle and the bridge
contract: what the embedder provides the guest, what the guest hands back, the
call lifecycle, and which guest-controlled arguments the embedder must check.
rifty's own `runCode` host runs on the same export, so the export is the one
real implementation, covered by the existing host tests. The export is
unstable: its contract may change in any release.

Not guaranteed for a custom embedder: rifty's host limits (time, heap, RSS,
output cap), the kill, the process boundary and the isolate-escape posture
(ADR-0557) stay the host's; with its own embedder they are the embedder's duty.

## User scenario

1. A Node 24 service that already uses isolated-vm installs the packed export
   package by its README; installing and importing it brings no native addon.
2. It wires the README's custom-integration example — only the public export
   plus its own isolated-vm — and runs each snippet of the isolate-host parity
   corpus; each `{stdout, stderr, exitCode}` equals `node -e <code>` from the
   same Node.
3. The README tells it, per bridge function, the arguments, who controls them
   and what the embedder must check, and which guarantees of rifty's host do
   not hold for its own integration.
4. A guest calling bridge functions with hostile arguments, or returning a
   non-status, cannot make the export's bridge throw a host error or act
   outside its contract.
5. `runCode` users see no change.

## Invariants

<!-- False on main 4018de0fc: no package but `@riftydev/isolate-host` holds the
guest (`ls packages`); its root exports only `runCode`
(`packages/isolate-host/src/index.ts`); the bundle and `createBridge` are
internal (`src/guest/*`, `src/child/bridge.ts`, not in `exports`); the only
install path pulls `isolated-vm@7.0.2` (`packages/isolate-host/package.json`
dependencies); the README has no integration section. -->

- I1. Embedder parity: an embedder importing only the export package
  (installed from its packed tarball) and its own isolated-vm 7.0.2 runs every
  isolate-host parity-corpus row with `{stdout, stderr, exitCode}` equal to
  `node -e <code>` (live oracle, same projection and declared ceilings as
  `runCode` parity).
- I2. One implementation: `runCode` runs the export's guest bundle (the
  file is byte-identical); the existing isolate-host tests pass with no
  assertion changed (a relocated test keeps its assertions), the host root
  still exports only `runCode`, and its README install steps are unchanged.
- I3. No native addon: the packed export declares no dependency; installed
  alone into a clean project, its root imports and its bundle resolves with no
  isolated-vm present.
- I4. Documented contract: the export README's custom-integration code block
  is the I1 embedder (the test runs the block itself); the README names per
  bridge function its arguments, who controls them and what the embedder must
  check, states which isolate-host guarantees do not hold for a custom
  integration (limits, kill, process boundary, escape posture), names the
  tested isolated-vm version and the 6.2.0 / other-embedder ceilings, and marks
  the export unstable with what that means for versions.
- I5. Hostile guest: every bridge function a guest can call refuses each
  out-of-contract argument with a guest-safe `TypeError` (no host frame or
  path), a guest-returned status outside 0..255 integers reads as exit 1, and
  after the embedder ends the call no host timer fires or is armed.

## Challenge

challenge: 2026-11-18 — 1 problem

- Outcome promised "its own isolated-vm version or another embedder" while I1
  pins one version and ivm 6.2.0 lacks both hooks the corpus needs; resolved:
  Outcome narrowed to the tested 7.0.2, 6.2.0 and other embedders declared
  ceilings (I1, I4 name them).
- Advisory: guest-visible texts keep the `isolate-host` brand
  (`isolate-host bridge: …`, `isolate-host.dynamic-import`) — `runCode` output
  must not change (scenario 5); recorded in Decisions.

## Decisions

- tier `works`: honest happy path for a conforming embedder; hostile guest
  arguments (I5) refused; embedder-side faults (its limits, kills) are its own.
- Shape: a separate package `@riftydev/isolate-guest` with no dependencies
  (the bundle as an asset subpath, the bridge contract, a validating bridge
  wrapper); isolate-host builds its child on it and ships the same bundle
  file in its own `dist`, so its install stays one tarball. A subpath of
  isolate-host fails I3 (its install pulls isolated-vm). ADR at the export unit.
- The host's child builds its bridge with the export's validating wrapper; a
  second copy is duplicate machinery (`REV-7`), not an invariant.
- Probe 2026-11-18, Node v24.16.0, isolated-vm 6.2.0 vs 7.0.2 (script and
  verbatim output: `ledger.md`): `evalClosure` with `ivm.Callback` arguments
  works on both; on 6.2.0 neither
  `onUnhandledRejection` nor `importModuleDynamically` fires — `import()`
  rejects in the guest with `Not supported`, an unhandled rejection rejects
  the embedder's `eval`. The contract names both hooks as embedder duties;
  an embedder without them loses those two behaviors (README states it).
- rejected route: document the existing `dist/guest.js` of isolate-host as the
  export — violates I3 (installing isolate-host installs isolated-vm 7.0.2).
- rejected route: a second, embedder-only bundle or bridge beside the host's —
  violates I2.
- Guest-visible texts keep their `isolate-host` names (bridge refusals, the
  `import()` gap): they are `runCode` output today (scenario 5).
- The interpretation in §Outcome is the manager's, unconfirmed by the user; a
  user "no" is an amendment (`RDY-6`), not a reason to hold the run.
