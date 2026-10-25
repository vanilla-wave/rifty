# ADR 0430: Refresh clean editor captures from public owner writes

Status: Accepted
Date: 2026-09-13

## Context

PR-333's real React UI RED: public agent file write/build/preview succeeded,
then Explorer could not open main.tsx: "changed while its editor document
opened". Playground pre-captures Documents for sync editor bytes; its writer
reused a clean old handle after an ordinary file write. ADR-0273 deliberately
keeps a Document's captured CAS base; only rename/remove/reset invalidate it.
Changing that SDK contract would silently rebase unpublished editor text.

## Decision

1. Keep ADR-0273. The Playground writer's existing per-path FIFO also owns a
   clean capture refresh: open a new real Document, compare the current mirror
   version, let the view accept its exact bytes, then replace the cached handle.
   A dirty Document or rejected view keeps its original handle/base.
2. The existing editor write-generation state decides whether Monaco has
   unpublished edits. `applyOwnerBytes` refuses those buffers; clean models
   adopt owner text in place. A synchronous owner-update origin suppresses
   writing that text back, while retaining normal document/LS notifications.
3. One generic binding observes public file snapshots and model opens, using
   the mirror's existing versions and the existing editor-binding lifetime.
   No action-origin filters, second file cache, retry loop or scheduler.
   Existing rename/remove handling remains; missing files are not fabricated.
4. Opening a not-yet-open editor explicitly refreshes a cached clean capture.
   Already-open models retain their capture; pending user edits are never given
   a newer base without adopting the matching bytes.

## Mechanism sweep and alternatives

- Existing owners: mirror entries/versioned byte cache; writer handles/FIFO;
  SDK immutable Documents/CAS; editor models/write generations; App binding epoch.
  Reuse them. Only a synchronous source discriminator is new in the editor:
  otherwise model.setValue would publish an artificial second write.
- AI-specific close/reopen around writes: rejected. The executed failure uses
  ordinary public files, so shell/SDK writers share it; caller wrapping leaves
  that class and removes unrelated editor-tab state.
- Blindly refresh every capture: rejected by ADR-0273 and the real Monaco test
  with an unpublished edit: local text and its old CAS base must survive the
  external winner and its resulting conflict.
- Chosen in-place model/capture binding: native tests prove same model, zero
  write-back, exact next-save CAS, fresh unopened file and preserved dirty bytes.
  Commands and raw observations: `docs/backlog/playground/reference/ai-mode-chat-evidence.md`.

## Consequences

Clean UI follows existing owner writes. Dirty buffers retain explicit conflict
semantics; this does not implement the separate editor-conflict recovery UI.
Editor public type declarations move unchanged to a focused file to keep the
implementation file's ratchet. No runtime or AI-specific dependency is added.
