# ADR 0329: Authority-owned project Save rebinds exact installed-tree trust

Status: Accepted
Date: 2026-07

> TL;DR: Scratch→named Save keeps the exact installed tree without acquisition:
> the existing package FIFO copies only ordinary bytes, then the sole
> install-stamp authority proves the source and mints a target-root v4 claim
> before the catalog pointer commits.

## Context

ADR-0307 made install trust a protocol commit rather than surveillance of later
`node_modules` writes. The Vite churn proof is green, but production Save still
copies Scratch with `copyClaims: false`; opening the new named root therefore
runs snapshot/install acquisition again. That breaks the frozen offline
A→B→A outcome even though the copied dependency bytes are already exact.

ADR-0261 correctly forbids copying root-bound claim bytes. It also requires the
destination authority to demote and mint trust only after proof, but did not
define a proof for the destructive, same-store Scratch→named conversion.
General copy, export, archive, snapshot, and cross-store restore must remain
claim-free and untrusted.

Adding a Save cache, transferring the marker, or adding a second lock/FIFO
would create another state owner. The package-tree FIFO and install-stamp
authority already own the required ordering and trust commit.

## Decision

- Add one internal `project-save` operation to the existing package-tree
  authority. It holds the existing owner-wide package FIFO across source proof,
  catalog copy, target claim publication, and catalog-pointer commit. Guest
  writers are already excluded because Save admits no live project.
- The catalog copy remains claim-free at every depth. It preserves every
  ordinary project and `node_modules` byte, including Vite `.vite-temp` output,
  while continuing to exclude owner-private `tree/.rifty` state.
- After the target bytes and prepared transaction marker are durable, but
  before the catalog pointer commits, the sole install-stamp authority performs
  a Save-specific rebind:
  1. canonical source and target roots must be distinct;
  2. the source must have a current trusted v4 claim for its exact root, slug,
     package text, lockfile hash, and current install-artifact identity;
  3. the target claim must be absent; target `package.json` must be byte-equal
     to the source claim and its lockfile must satisfy the same
     hash-or-absence fact;
  4. the authority runs the existing target
     `demote → full-ledger flush → promote` protocol, using the target
     root/slug and the source's package count.
- No marker bytes, epoch, ready set, or runtime assets transfer. The target
  claim is a newly proven v4 claim. A later open decodes the copied lockfile
  through the ordinary trusted-tree path and performs zero
  snapshot/registry/install work.
- An untrusted, pending, stale, or identity-drifted source does not mint target
  trust; Save may still preserve its ordinary bytes claim-free. Once the source
  is trusted, target mismatch or publication refusal fails Save loudly and
  rolls the target back rather than silently degrading a proven offline Save.
- Catalog durability remains the commit point. Before that pointer, recovery
  keeps Scratch and removes the staged target plus any target claim. After it,
  recovery keeps the already-trusted named target and removes Scratch plus its
  source claim. A temporary pair of truthful claims may exist between target
  promotion and pointer commit; only Scratch is catalog-reachable then.
- General copy/export/archive/snapshot behavior is unchanged: claims are
  excluded, copied roots are untrusted, and ordinary destination acquisition
  is required.

This supersedes only ADR-0261's broad consequence that every copied project
must reinstall. Uncoordinated copies still do; the one authority-mediated
destructive Save conversion rebinds after the ordinary destination proof.
All other ADR-0261, ADR-0278, ADR-0279, ADR-0307, and ADR-0309 clauses stand.

## Consequences

- (+) Saving an already-trusted Vite Scratch and reopening the named project
  offline preserves the exact dependency bytes and skips all acquisition.
- (+) Reserved metadata never enters an ordinary tree-copy plan; root binding,
  ingress rejection, and full-ledger promotion remain intact.
- (+) No new lock, FIFO, cache, epoch, store, ready-set clone, or recovery
  protocol is introduced.
- (−) Save of an untrusted Scratch remains honestly untrusted and may need
  acquisition when opened; it cannot manufacture provenance from copied bytes.
- (−) A trusted-source Save now fails when target durability/provenance cannot
  be proven, instead of reporting Saved and paying a hidden reinstall later.

## Fault matrix

| Fault | Required outcome |
|---|---|
| `torn-state` | Crash before catalog commit removes target claim/tree and retains trusted Scratch; crash after commit retains trusted target and completes Scratch removal. |
| `quota-perm-fail` | Target demotion/promotion or pointer durability refusal rejects Save; source and prior catalog remain authoritative; retry is allowed. |
| `torn-state` / `quota-perm-fail` × untrusted source | No rebind runs. Existing catalog recovery keeps exactly the pre-pointer Scratch or post-pointer claim-free target; failure cannot mint trust, and later open uses ordinary acquisition. |
| `concurrent-same-key` | The existing package FIFO orders install/child admission wholly before or after Save; no second serializer exists. |
| `provenance-lie` | Wrong source root/slug/artifact/package/lock, pending/corrupt claim, or mismatched target bytes cannot mint target trust. |
| `lossy-aggregate` | Target root and slug are re-keyed; the source marker/epoch is never copied. |
| `sibling-drift` | Top-level and nested reserved claims stay excluded; only the target project root receives a new claim. |

## Rejected alternatives

- Copy/rewrite the source marker: bypasses the authority and turns reserved
  metadata into transferable payload.
- Re-run snapshot/install during Save: violates the offline/zero-acquisition
  outcome and needlessly replaces already-proven exact bytes.
- Cache the tree or add a Save lock/FIFO: duplicates the existing owner and
  coordination mechanism.
- Clone in-memory package readiness/runtime assets: target open can derive its
  exact plan from the copied lockfile; cloning adds state without acceptance
  value.
