---
area: distribution
status: draft
title: Apply snapshots through explicit saved-state and file-conflict policies
created: 2026-09-07
why: Changing snapshotId currently reseeds an edited Scratch, while hosts need saved state by default and an explicit uniform file-conflict policy for application.
user_story: As the plugin-sandbox embedder, I want saved projects to win after initial deployment and choose overwrite or error when explicitly applying a snapshot, but current catalog identity changes can silently replace edited files.
epic: self-hosted-snapshot-workbench
blocked_by: [distribution/dep-snapshot-producer]
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, ADR-0279, ADR-0261]
code: [packages/workbench/src/workbench/internal/playground-project-definition.ts, packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/glue/dep-snapshot.ts]
---

## Context

A disposable catalog probe changes only the supplied snapshotId after writing
user.txt to Scratch, then calls createScratch with preserveDirtySameStarter.
Current result is dirty=false and user.txt absent. Same-definition reload
preservation does not cover that path. See the recorded evidence.

User-selected application modes:

- Initial deployment only (default): seed an absent project; subsequently use
  saved state, including when the host supplies a new snapshot. Do not fetch or
  apply an unused asset merely because its id changed. Missing install trust
  is not evidence that no saved project exists. Incompatible saved state fails
  with all bytes retained, awaiting the host's explicit choice.
- Apply: evaluate the supplied payload on every requested application,
  regardless of prior snapshotId. User selects overwrite or error conflict
  policy; error defaults from the preserve-before-explicit-update decision.

Conflict is structural: different bytes at an existing file path, or an
incompatible entry/ancestor type. Identical files and directory/directory
coexistence are nonconflicting. Missing payload targets are added. In error
mode report conflicting paths before ANY payload mutation, including additions.
In overwrite mode replace conflicting targets, including the subtree of an
incompatible directory target; otherwise preserve saved paths absent from the
payload. The request is application of entries, not an implicit whole-project
reset. An archive's user/control namespaces remain disjoint; control entries
are never installed as project files.

No policy branch examines whether a conflicting path is package.json,
package-lock.json or node_modules: the user explicitly rejected that distinction.
A producer artifact still needs valid compatibility and integrity proofs.
Preserving extra/local files does not authorize claiming the entire resulting
tree equals the producer's installed tree. Retire/rederive affected install
claims through their existing authority; do not bypass conflict policy or run
an automatic install to manufacture a clean claim. Source edits outside the
application targets must remain usable as ordinary project state.

The policy owns selection/preflight; catalog transactions and package-acquisition
remain the existing effect owners. Wire/API names are agent-owned ADR decisions.
Cover Scratch and named saved projects on reopen, new/same snapshot ids, ordinary
file/path-type conflicts, exact-equal files, absent targets, retained extra
files, and error-before-any-write. Package filenames are ordinary collision
fixtures, not a separate semantic mode. Real OPFS crash/reopen must not publish
partial application as completed or destroy the only preserved copy.

## Decisions

- 2026-09-07 — user: initial-deployment-only default; saved state wins afterward; explicit apply mode exists (I8).
- 2026-09-07 — user: conflicts choose overwrite/error, no dependency-specific behavior; applies independently of prior snapshotId (I8).
- 2026-09-07 — default error follows the user's preserve/stop choice; paths not targeted by application remain saved data, not deletion candidates.
- 2026-09-07 — exact API/carrier and install-claim reconciliation need an ADR at pickup, preserving the user-owned policy; inherit production tier for new persistence transitions.

## Challenge

challenge: 2026-09-07 — clear
