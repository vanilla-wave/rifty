---
kind: epic
status: ready
title: Trusted-state authority — one owner for every trust claim over storage
created: 2026-07-11
value: Any "this multi-file state is complete/valid" claim (install stamp today; caches, git index, multi-tab tomorrow) is owned by ONE serialized, durable-proving authority — reload/crash/concurrent writers can never make the platform silently trust torn state, and building the NEXT trust claim costs a primitive call, not five review rounds.
user_story: As a developer, I want to reload, switch projects, or run installs from two terminals at any worst moment and always reopen a provably honest project, but today that guarantee is held by ~7 hand-rolled coordination mechanisms scattered over 3 modules — each new writer or storage plane interleaving is a fresh trust bug found only by review (42 findings across 5 rounds on PR #131).
items: [vfs/trusted-state-primitive]
---

## Outcome

PR #131's review saga (ADR-0216 §audit) proved the design defect: the install
stamp — a trust claim "this node_modules is complete + durable for inputs X" —
has multiple writers (command demote/promote, boot promoter, from-scratch
clear, instant restore, restampSlug) across two storage planes (session mirror
vs OPFS), each interleaving individually guarded by its own mechanism
(generation, phase lock, stamp chain, promotionId, sync recheck, demote-proof
ladder, prepare hook). Every mechanism is now individually RED-proven, but the
invariant has no owner: the next writer added is one review round away from a
torn-trust bug, and every future trust claim (tool caches, git index,
multi-tab plane ownership) re-buys the same distributed-systems zoo.

This epic consolidates the invariant into an AUTHORITY: a small state machine
(absent → pending → trusted; verbs demote/promote/revoke/check) that owns ALL
claim transitions — internal serialization (no TOCTOU by construction),
durable-proof inside promote/demote (drain + full-ledger check; an unproven
revocation aborts loudly), byte-exact input identity (never a lossy
aggregate), epoch fencing (supersedes the generation/promotionId zoo), honest
resting state on death anywhere (pending/absent → redo work). The claim stays
a real, cat-able file — deleting it with the tree is honest revocation, never
hidden state. Enforcement is mechanical, not reviewer vigilance: an
arch/source-grep gate makes the authority the only writer of claim paths, and
one contract suite runs the machine over every Vfs impl (Memory, SyncMirror,
Opfs) so a lenient sibling can never void a strict-impl proof again
(`sibling-drift`).

Deliberately NOT transactions for general file I/O: plain `fs` keeps exact
Node parity (Node has none either). The primitive is narrow — derived trust
claims only. Generalization beyond the stamp is GATED on a second real
consumer (entity-cut, no framework speculation): learned pins' hand-rolled
chain+CAS and the multi-tab plane-ownership story are the named candidates.

## User scenario

A developer runs `npm install cowsay && npm run dev`, reloads mid-drain,
switches projects and back, or fires installs from two terminals — every
reopened tree either reuses a PROVEN install or honestly re-installs; never a
silently broken project. A contributor adding the next install-adjacent
feature (`npm uninstall`, `npm ci`, a build-cache validity marker) calls
`demote/promote` on the authority and inherits every guarantee — instead of
adding an eighth guard and five review rounds.

## Items

- `vfs/trusted-state-primitive` (draft, gated) — lift the authority into a
  generic storage-layer `TrustedState` when the SECOND consumer lands
  (learned pins / build-cache marker / multi-tab Web-Locks plane ownership).

Process guards (fault-classes design-stop trigger, delta-scoped review
rounds, TEMPLATE writer-set question) shipped directly with PR #131 — not
items here.

## Out of scope

- VFS-level transactions/MVCC for general file I/O (anti-goal: Node parity —
  real `fs` has none; heavy scripts keep exact Node semantics).
- Multi-tab implementation itself (its epic consumes this primitive).
- Changing any user-visible install/reload behavior — the consolidation is
  behavior-preserving by contract.
