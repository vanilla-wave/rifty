# ADR 0414: Keep Scratch mutation policy in the companion

Status: Accepted
Date: 2026-09

## Context

PR #323 requests IDE-owned dirty semantics. Independent DEC-2 review:
`/root/decision_323`, 2026-09-10. ADR-0278 and ADR-0307 classifications remain.

## Decision

Generic project VFS/npm paths report applied filesystem and operation facts.
The Playground companion in the owner Worker decides whether those facts mark
Scratch dirty and awaits the existing catalog transaction. Initial generated
lock handling belongs to that companion too. No second dirty state owner.
Editor, guest, SCM and import edits still count; seed, first clean dependency
arrival and writes strictly inside node_modules retain their exclusions.
The page consumes authoritative catalog clean state after Reset.

## Alternatives

Editor-only listeners lose guest/npm/SCM edits and reload durability. Another
journal duplicates existing applied mutation/publication evidence. Companion
classification on existing callbacks preserves the current settlement boundary.

## Consequences

Adds ownership detail to ADR-0278; no dirty-policy change. VFS tree revisions
remain publication evidence, independently of the Scratch boolean.
