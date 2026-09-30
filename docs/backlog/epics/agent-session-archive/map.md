# Map — agent-session-archive

## Items

1. `distribution/agent-session-archive` — **shared archive** — establish the
   public storage/access boundary and prove one saved conversation after reopen,
   then cross-session/project discovery on both public hosts; owns I1–I4.
   Keep capture, durability and read access together until evidence justifies
   a split: no independent competing archive owner.

## Open questions

- Common filesystem access without escaping project isolation — owner: agent —
  PICKUP probes real SDK/Workbench persistence and public access capabilities;
  choose the smallest shared boundary by ADR. Existing project file tools alone
  cannot access another project or owner-private metadata.
- Native message capture, compaction, reset, interrupted turns and durability
  acknowledgement — owner: agent — probe Pi 0.85.1 events and actual storage;
  specify complete versus incomplete records without replaying tool effects.
- Archive format/path, discovery instructions and large histories — owner: agent —
  demonstrate reading an older message beyond current tool output limits; choose
  readable records without freezing JSONL, mounts, an index or a search service.
- Storage ownership and concurrent access — owner: agent — inventory existing
  owners before adding coordination; compile reachable fault rows for real
  OPFS/Worker boundaries, including quota, corrupt input, interrupted writes
  and cross-tab writes. No silent memory-only success.
- Public consumer wiring and proof — owner: agent — test installed SDK sandbox
  and Workbench paths against real storage; mock only the external model boundary
  for deterministic archive/tool proof, add a real-model recall acceptance run.

## Out of scope

- Physical computer folder: user chose rifty filesystem.
- Chat list/resume UI: user chose agent recall on request.
- Playground integration: explicitly optional; SDK + Workbench close the goal.
- Cloud/device/browser-profile synchronization and recovery after deliberate
  site-data deletion or browser eviction: no such service or promise requested.
- Retroactive recovery of chats never stored by existing code: no source exists.
- Automatic injection of every archived conversation into the active context:
  on-request discovery is the accepted scenario.
- Project file rollback, process snapshot/restore and replay of old tool actions:
  the archive records conversations; `distribution/public-api-ai-agent-contract-snapshot-restore`
  remains separate.
