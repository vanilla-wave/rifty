# ADR 0402: Mount Workbench namespaces through one captured OPFS root

Status: Accepted
Date: 2026-09

## Context

Goal I4 requires opt-in origin storage addressing: a new namespace has no old
projects; former settings retain former data. Existing async/sync OPFS surfaces
both acquire origin root. Actual native probes show a supplied root is ignored,
A/B preload origin data and write over the same outside sentinel. Research and
RED: docs/backlog/vfs/reference/workbench-storage-namespace-evidence.md.

## Decision

1. Add `storage.namespace?: string` to both Workbench entrypoints. A namespace
   is one literal OPFS directory component: reject non-string, empty/blank,
   NUL, slash, backslash, dot and dot-dot. Preserve other characters/spaces;
   never trim, normalize or URL-decode. Omitted/undefined means the exact
   historical origin root. Capture the selected value before asynchronous work
   and revalidate it on the existing owner wire.
2. Resolve origin/<namespace> once inside the existing owner storage
   composition's actual `openOpfs` branch. Supply that same native directory
   handle to both surfaces through `installOpfsFs(root?)`, `OpfsVfs.init(root?)`
   and static `OpfsFsSync.init(paired?, root?)`. No-arg callers retain origin
   defaults. The pair publishes only after both surfaces initialize; no path
   prefix adapter, new backend, registry or write coordinator.
3. The handle is the instance's fixed mount. Ordinary no-arg lazy init stays
   idempotent; conflicting re-initialization rejects instead of silently
   changing or ignoring the selected root. Existing root state owns this rule;
   no new initialization queue or live namespace setter. Workbench selection
   changes only across close/open. No raw handle is added to Workbench API.
4. All logical paths and identities stay unchanged: projects, cache, claims,
   catalog/stages/legacy recovery and proof nonce paths descend from the selected
   handle. Namespace is not a project/snapshot/install identity. New selections
   never import origin-root legacy state or clear an existing selected directory.
5. Syntax failure rejects before owner/lease/SW/storage effects, under every
   persistence policy. Valid ephemeral mode opens only Memory VFS. OPFS open,
   entry-file conflict and proof failures retain required rejection or preferred
   visible memory fallback. Never overwrite a namespace file or recursively
   delete the selected directory on failure; a failed boot may leave an empty
   selected directory or existing proof residue, confined to that selection.
6. Retain the origin-wide Workbench lease, including distinct namespaces.
   Concurrent owners remain outside the goal; no namespace-keyed lease or
   namespace registry. Host-owned storage outside Workbench, including the
   first-party App's separate terminal history, remains host-owned.

## Alternatives

- One captured handle at the existing paired backend seam: both ordinary
  indexing/preload and reads/writes inherit the bound, including private paths.
- Prefix only projects/catalog: leaves preload, shared cache and proof paths at
  origin; fails the native outside-sentinel oracle and I4.
- Prefix every filesystem operation in a new wrapper: duplicates native
  addressing/persistence semantics; the existing handle already supplies them.
- Clear/migrate a selected directory or namespace the lease: contradicts the
  user's preserved-old-setting/no-migration/single-owner decisions.

## Proof and retained authorities

Real native A/B/default roots, sync/async coherence, outside sentinel and
conflicting init; public options/owner/persistence policy; global A/B Web Lock;
public packed persistent project reopen. Crash/reload carriers preserve current
catalog/claim recovery through the selected physical prefix.
ADR-0263/0279 retain owner/lease/catalog authority; ADR-0072 retains paired cache/
write-through, ADR-0358 drain semantics and ADR-0372 actual backend truth.
The separately captured unreadable-cache-as-empty defect stays linked to I6's
preservation prerequisite; namespace addressing does not certify that defect.
