# ADR 0482: Shared durable agent conversation archive

Status: Accepted
Date: 2026-09-30

## Context

Archive goal I1–I4 requires original conversations independent of project
lifetime, through both hosts. ADR-0466 remains the explicit context-restore
contract; ADR-0474 compaction remains a context projection.

## Decision

- Optional `AgentSessionOptions.archive = { namespace, project: { id, name } }`.
  Host selects one shared local namespace and source identity. Agent owns capture;
  existing host-managed `initialMessages` and Playground behavior stay unchanged.
- Reuse public `OpfsVfs` from `@riftydev/vfs` (workspace dependency). Archive at
  `/.rifty-agent-archives/<namespace>/<random-session-id>.json`, outside project
  trees. No memory fallback. Missing OPFS or persistence failure is visible.
- One JSON snapshot per conversation, versioned envelope with SHA-256 of its
  payload. Include original native messages, source identity, revision and
  `incomplete`/`complete` settlement. Compaction never replaces archive messages.
  Reset selects a fresh UUID; no archive writes share session IDs across tabs.
  Host-restored `initialMessages` stay the host's record (ADR-0466): the envelope
  carries `restoredMessageCount`, never their copy — one conversation, one file.
- Native writable close is the durability boundary. Emit `archive` receipt only
  afterwards; `send` settles all admitted writes before final status. Begin each
  run with an incomplete snapshot; finish marks complete only after settlement.
  Browser death leaves the last acknowledged snapshot and explicit incompleteness.
  A corrupt file fails `archive_read` loudly; `archive_search` lists it under
  `corrupt` and keeps healthy conversations discoverable. Historical tools are
  never replayed.
- `archive_search` scans project identity and original text (never image bytes),
  returns paginated matches newest first; `archive_read` returns paginated original JSON. Both read-only, available
  even when project tools are unavailable. No transcript injected automatically.
- Capture Pi message_end and discarded assistant retry receipts before compaction.
  Preserve admitted images/tool payloads, never serialize provider configuration.

## Alternatives and mechanism inventory

- Reuse a project's snapshot/persistence owner: rejected; Workbench deleteProject
  removes its container, public project files cannot escape it (refine evidence).
- Separate shared SDK sandbox/worker or mount: rejected; OpfsVfs already provides
  the necessary file operations; another runtime owner adds no archive behavior.
- Shared mutable index/JSONL across sessions: rejected; requires cross-tab locks
  and torn append recovery. UUID-owned atomic snapshots need neither.
- Existing OpfsDrainScheduler owns synchronous VFS write-through, project owner
  mutation queues own project commits, session.pending owns resource reads.
  None owns native async archive snapshots. One session-local promise chain orders
  capture/settlement; no per-key map, global lock, manifest or second coordinator.

## Evidence

Source inventory and browser RED/probes:
`docs/backlog/distribution/reference/agent-session-archive-evidence.md`.
