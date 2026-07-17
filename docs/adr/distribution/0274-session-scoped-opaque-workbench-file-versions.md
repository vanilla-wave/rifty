# ADR 0274: Session-scoped opaque Workbench file versions

Status: Accepted
Date: 2026-07

> TL;DR: Public file versions are stable equality tokens scoped to one live
> ProjectSession; raw owner authority never crosses the Workbench API.

## Context

ADR-0273 requires opaque public versions and forbids owner identity/revision
evidence. Owner VFS versions deliberately contain owner epoch, tree revision,
and sequence so the private CAS authority can diagnose ownership. Forwarding
that string exposes the forbidden evidence. It also lets a token from another
session reach owner transport before failing CAS. We need exact CAS round trips
without making owner identity public or treating tokens as persistent data.

## Decision

Each `ProjectContentController` creates one version boundary shared by its Files
and Documents controllers. The boundary has a cryptographic session nonce and
monotonic slots. It maps each raw owner version to one stable public token and
maps that token exactly back to the raw version. Tokens contain no owner epoch,
revision, physical/logical path, or raw version substring. Cryptographic nonce
support is required; absence throws loudly, with no pseudo-random fallback.

Every version-bearing public result uses the boundary: atomic reads, directory
entries, source snapshots/subscriptions, mutation results, document snapshots,
and conflict expected/actual/entry evidence. Every conditional mutation decodes
its token before owner transport. `null` continues to mean absent. An applied
ACK registers its raw version and advances document CAS even when later
reflection/durability fails; unknown outcomes retain the previous mapping/base.

A token is valid only for the live ProjectSession that minted it. Unknown or
foreign-session strings reject as `TypeError` before owner transport. Old known
tokens remain valid for that session so stale CAS reaches the owner and returns
exact conflict evidence. Session close fences the handles; tokens are neither
persistent nor transferable to a reopened session.

## Consequences

- Public equality/CAS stays faithful while private owner authority stays private.
- Files and Documents cannot drift because one session boundary owns the mapping.
- The session retains mappings for every observed raw version until collection;
  this preserves stale-token CAS semantics and bounds lifetime to the session.
- Hosts must reacquire versions after reopening a project session.
