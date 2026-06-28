---
area: playground
status: ready
title: Explorer single-file Download (working bytes → OS, incl. over-cap via new owner read)
created: 2026-06-28
why: "Any file manipulation" includes getting a file back OUT; today the only egress is the whole-tree exportArchive — there is no single-file download, and over-cap (>128KB) files have NO general owner read (only node_modules has nmCache.readFile).
user_story: As a dev, I want right-click → Download (and Ctrl/Cmd+S on a tree selection) to save a single working file to my OS, but today I can only export the entire project as an archive.
epic: scm-file-manager
blocked_by: []
sources: [docs/backlog/epics/scm-file-manager.md, ADR-0148, ADR-0165, apps/playground/src/glue/vfs-snapshot-port.ts]
code: [apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/vfs-snapshot-port.ts, apps/playground/src/glue/snapshot-fs.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/App.tsx]
---

## Context

The snapshot inlines content only `<128KB` (`SNAPSHOT_MAX_CONTENT_BYTES`,
`vfs-snapshot-port.ts:29`); `SnapshotFs.readFileBytesSync` serves those bytes.
Over-cap/binary working files have NO general owner read: the only async read-port
is `readNodeModulesFile → nmCache().readFile` (`App.tsx:1277`), node_modules-scoped.
So a faithful single-file download needs a NEW owner read for arbitrary working
blobs (the working-tree analog of `nmCache.readFile`). The egress precedent is the
existing `exportArchive` (whole-tree) + browser Blob/anchor download.

## Scope

- **In:** a tree affordance (context-menu Download + Ctrl/Cmd+S on a selected file)
  that fetches the FULL working bytes and triggers a browser download (Blob +
  object-URL anchor, original basename). `<128KB`: from `SnapshotFs` inline bytes.
  `>=128KB` or binary: via a NEW owner over-cap read frame on the snapshot port
  (`readFileBytes(path) → Uint8Array`), with the owner-exited guard. Binary via
  `looksBinary` (download as-is, no text decode).
- **Out:** folder/multi-file download (use whole-tree `exportArchive`); editor
  over-cap VIEWING (separate concern); the HEAD-blob read (`scm-diff-original-content`
  uses git `show`, a different path).

## Guardrails

- **No truncation, no placeholder.** An over-cap file downloads its FULL bytes via
  the owner read — never the truncated snapshot, never an empty/`// too large` stub
  saved to disk.
- Owner is the source of bytes for over-cap/binary (page has no authoritative fs);
  the read frame carries the owner-exited guard, rebinds on respawn (ADR-0165).
- Binary downloads are byte-identical (no UTF-8 round-trip).

## Acceptance

- E2E: Download a small text file → saved bytes equal the working file exactly;
  Download a `>128KB` file → full bytes (not 128KB-truncated); Download a binary
  (e.g. a PNG) → byte-identical; a Download during owner respawn fails loudly.

## Parity cases

- Downloaded bytes of any working file equal `fs.readFileSync(path)` over the owner
  VFS, byte-for-byte, for sizes both under and over `SNAPSHOT_MAX_CONTENT_BYTES`.
- A binary file (non-UTF-8 bytes, `looksBinary` true) downloads with its exact
  bytes — no decode/re-encode corruption.
- The downloaded filename is the working basename (e.g. `src/index.ts` → `index.ts`).

## Out of scope

- **Folder / multi-select download** → not offered here; whole-tree egress is
  `exportArchive`. A folder Download is a no-op/disabled, NOT a fake zip.
- **Download of a node_modules / over-cap-only-in-snapshot path that the owner
  cannot read** → loud throw (owner-exited / not-found), never a partial save.
- **Save-As path picker** (choosing an OS destination dir) — the browser download
  API gives the user the OS save dialog; rifty does not control the target path.

## Decisions

- A NEW owner read frame `readFileBytes(path) → Uint8Array` on the snapshot port is
  the general working-blob read (the non-node_modules analog of `nmCache.readFile`);
  REVERSIBLE additive frame, CHANGELOG line, no ADR (applies ADR-0148 owner-SSoT).
- `<128KB` uses the already-inlined snapshot bytes (no RPC round-trip); `>=128KB`
  or binary uses the new read frame.
- Browser download via Blob + object-URL anchor; user-initiated egress to the OS
  save dialog — standard, no extra confirm.

## Reversibility

REVERSIBLE — additive read frame + a tree affordance over the existing snapshot
port + export precedent; deletable. CHANGELOG line.
