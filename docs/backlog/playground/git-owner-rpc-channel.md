---
area: playground
status: ready
title: Page↔owner git-RPC request/reply channel over @riftydev/git
created: 2026-06-27
why: The page has no .git (excluded from the snapshot) so every SCM read/action MUST be an owner RPC into the git realm; the load-bearing new code is the channel, not the view.
user_story: As the playground SCM/diff UI, I want to call git verbs (status/diff/show/log/branch + add/unstage/commit/restore) in the owner realm and get typed replies, but today no git channel exists — git is reachable only via the shell builtin and the page can compute nothing git-related.
epic: scm-file-manager
blocked_by: []
sources: [docs/backlog/epics/scm-file-manager.md, ADR-0148, ADR-0150, ADR-0165, ADR-0167, packages/git/src/git.ts, packages/git/src/types.ts]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/vfs-write-port.ts, apps/playground/src/glue/starter.ts]
---

## Context

`@riftydev/git` `makeGit(opts)` (`git.ts:91`) is already constructed and run in the
owner realm over the live `.git` (`starter.ts:146/164 makeGit(...)`,
`real-vite-bootstrap.ts:170 ownerGitVfs()`, `:385 ensureStarterInitialCommit`). The
page cannot read `.git` (snapshot excludes it) so it needs an owner-relayed git API.

The transport precedent is in-repo: the ts-lsp relay (`real-vite-bootstrap.ts:814
relayTsLspRequest`, page dispatch in `realVite.ts`) and the id-correlated page
client `ts-ls-client.ts` (pending-map + per-request timeout-reject + `dispose()`,
no silent hang). NOTE the shapes differ: the ts-lsp OWNER handler blind-relays to a
grandchild process; a git owner handler must CALL `makeGit` verbs itself and reply
— the page client correlation is copyable, the owner handler is new domain logic.

## Scope

- **In:** a `rifty:git` request/reply channel keyed by `OwnerBridgeKey`
  (`realVite.ts:107 snapshotPort`). Owner handler dispatches reads
  `status()`/`diff(DiffInput)`/`show(rev)`/`log(LogOptions)`/`currentBranch()`/
  `listBranches()` and actions `add`/`unstage`/`commit`/`restore`/`reset` to the
  owner `makeGit`. Page client cloned from `ts-ls-client.ts` (id correlation,
  timeout, dispose). Typed result shapes reuse `packages/git/src/types.ts`
  (`StatusEntry`/`DiffEntry`/`ShowObject`/`LogEntry`).
- **Out:** the status-broadcast feed (separate item `git-status-change-feed`); any
  UI; remote ops (clone/fetch/pull/push).

## Guardrails

- Owner-side only — never a page-side `.git` read (ADR-0148; page has no `.git`).
- Lifecycle: keyed by `OwnerBridgeKey`; torn down + re-established on owner
  respawn (ADR-0165), like `tearVfsBridge`/`tearSnapReq`. An in-flight request
  during respawn rejects loudly (mirror `writeFile` "owner has exited"), never
  silent-drops.
- Engine ceilings pass through as the engine's own loud throws — the channel does
  not invent successes or wrap conflicts into a swallowing path.

## Acceptance

- A page-side test: the channel returns `status()` identical to the owner engine
  for a known tree; a request that outlives the owner rejects (not hangs);
  teardown leaves no live channel.
- No UI required — this is the UI-agnostic asset both views consume.

## Parity cases

- Channel `status()` deep-equals owner `makeGit().status()` (the `StatusEntry`
  list) for a known tree.
- `show('HEAD:'+path)` returns blob bytes byte-identical to the engine `show`.
- `add`/`unstage`/`commit`/`restore` produce the index/tree state the engine
  produces, verified via a follow-up `status()`.
- A request issued after owner exit REJECTS (mirrors `writeFile` "owner has
  exited") within the per-request timeout — never hangs.

## Out of scope

- Remote verbs `clone`/`fetch`/`pull`/`push` over the channel → NOT dispatched;
  `NotImplementedError` + compat ❌ (engine has smart-HTTP, but no channel/UI
  surface yet — epic out-of-scope).
- `merge`/`cherryPick` conflict handling → NOT wrapped; a conflict surfaces the
  engine's loud iso-git throw verbatim (no swallow, no fabricated
  `NotImplementedError`).
- A page-side `.git` read → impossible by construction (page has no `.git`); never
  a fallback path.

## Decisions

- App-internal owner↔page wire (`apps/playground` glue), not a public package
  export → CHANGELOG line, no ADR (applies the ADR-0148/0150 realm split).
- Result shapes reuse `packages/git/src/types.ts`; id-correlation/timeout/`dispose`
  cloned from `ts-ls-client.ts`; the owner handler CALLS `makeGit` verbs (not a
  blind relay like ts-lsp).
- Keyed by `OwnerBridgeKey`; torn down + rebound on owner respawn (ADR-0165).

## Reversibility

IRREVERSIBLE on merge: a new owner↔page wire contract (new public-ish surface).
CHANGELOG line; an ADR if the wire shape is stabilized as a cross-package contract.
The page client + owner handler are otherwise deletable (REVERSIBLE design).
