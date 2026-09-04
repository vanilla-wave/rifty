# ADR 0379: Resident entry admission authority

Status: Accepted
Date: 2026-09-04

> TL;DR: one internal resident-entry module owns loader generation, port
> provenance and live readiness settlement.

## Context

ADR-0378 chose causal port ownership over timer census. Its first
implementation exposed the mechanism across Workbench orchestration, builtin
override maps, HTTP/net wrappers and registry events. Final review proved three
escapes: realm-global `createRequire` could borrow the newest owner,
register→synchronous-close still settled readiness, and wrappers changed
Node factory/constructor identity.

Alternatives:

- patch the three sites independently: rejected; repeated `provenance-lie` at
  one seam requires class-kill, not more caller knowledge;
- replace the Worker before initial resident start: rejected; changes
  ADR-0377's existing-Worker start and emits an observable reset;
- one deep resident-entry module over in-process loader/net dependencies:
  chosen; smallest interface preserving the frozen contract.

## Decision

`startResidentNodeEntry({vfs,cwd,entryPath,args,requestedPort,timeoutMs})`
owns the selected loader generation and returns only `{port,completion}`.
Ownership tokens, builtin overrides, registry observation and error ordering
stay hidden.

A contextual loader supplies a loader-local `node:module.createRequire`; it
never overwrites the realm-global fallback used by older ordinary loaders.
Owned HTTP/net modules preserve their ordinary factory/class names in source
and packed output and require `createServer().constructor === Server`.
Readiness settles only if the exact owned registration remains live after
callback-queued microtasks.

## Consequences

- Workbench has one resident admission interface instead of five mechanism
  details.
- Old eval/runBin callbacks remain unowned regardless of async source or late
  CJS/ESM `createRequire`.
- HTTP/net observable identity remains unchanged inside each loader.
- Worker/SW receive only the settled port; ownership remains realm-local.
