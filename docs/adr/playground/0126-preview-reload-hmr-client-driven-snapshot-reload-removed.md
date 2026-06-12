# ADR 0126: Preview reloads are HMR-client-driven; snapshot-driven iframe reload removed

Status: Accepted
Date: 2026-06-12

> TL;DR: PR #15 (9cd61ca) deleted the `previewRevision`/`refreshKey` path that fully reloaded the preview iframe on every worker VFS snapshot. The iframe HMR client (ADR-0017 phase 1, ADR-0095) is now the only automatic reload path; the snapshot stream feeds the explorer mirror only. Recorded retroactively — shipped CHANGELOG-only, but it inverted a main-pinned contract.

## Context

- Commit f03ac50 (visible terminals; no ADR) introduced a snapshot-driven reload: `App.tsx` bumped a `previewRevision` signal on every `subscribeVfsSnapshot` frame and passed it as `refreshKey` to `PreviewPanel`, whose warm-up effect re-ran the full `about:blank → /preview/<port>/` cycle. Pinned on main by `App.test.ts` and `PreviewPanel.test.ts` (merge-base 5375e3e).
- In parallel, the HMR bridge's inlined iframe client (`glue/hmr-bridge.ts`) already calls `location.reload()` on an `{type:'update'}` payload.
- Two defects from the duplication:
  - every editor write reloaded the iframe **twice** (parent snapshot path + iframe HMR path);
  - the `m10-hmr` e2e was over-determined — it passed via the snapshot reload even with a dead HMR bridge, proving nothing about the bridge.

## Decision

Remove the snapshot-driven reload entirely (PR #15, commit 9cd61ca).

- `previewRevision` signal and `PreviewPanel.refreshKey` prop deleted; warm-up effect re-runs only on port change / manual Reload.
- The worker VFS snapshot stream stays, but feeds only the explorer mirror (`SnapshotFs`, ADR-0076) and `node_modules` presence (ADR-0080) — never the iframe.
- Automatic preview refresh = the iframe HMR client alone; manual fallback = the Reload button (`frame.contentWindow.location.reload()`).
- `m10-hmr` e2e now attributes the reload to the bridge: it requires `__riftyHmrOpen === true` and a `rifty:hmr:message` `{type:'update'}` event before the iframe update.

## Options considered

- **(a) Keep snapshot reload, gate it off during e2e.** Fixes proof attribution but keeps the prod double reload; test-mode divergence from shipped behavior. Rejected.
- **(b) Debounce/dedupe the two reload sources.** Two owners of one effect, timing-coupled; dedupe window is a guess. Rejected.
- **(c) Remove snapshot reload; HMR-client-driven only (chosen).** One reload per edit, one owner, e2e proves the bridge.

## Consequences

- Single reload per edit; iframe state survives snapshot frames that carry no update.
- `m10-hmr` e2e is a genuine bridge proof, not an explorer-refresh side effect.
- **Honest negatives:** the bridge is the sole automatic path — a broken/deaf bridge leaves the iframe stale until manual Reload. And iframes from a previous dev-server session never rejoin: per-server token rotation (`createHmrBridgeToken`) changes the `BroadcastChannel` name on every server start.
- The main tests pinning the old behavior were rewritten into their negation (`App.test.ts` "keeps worker snapshots from reloading the preview iframe"; `PreviewPanel.test.ts` "does not accept a parent snapshot refresh key"). Not a relax-the-test violation: the design change is recorded here, and the tests pin the successor contract — they were not loosened to pass failing code.
- `PreviewPanel.tsx` doc-comment states the contract: "File edits are refreshed by the iframe HMR client itself, not by parent snapshot updates."

## Reversibility classification

**IRREVERSIBLE** — observable-behavior change with live alternatives (the rejected alternative was literally pinned by main tests). Shipped in PR #15 with only an `apps/playground/CHANGELOG.md` entry; this ADR closes that recording gap per record-and-continue.

## Cited ADRs

- ADR-0017 — `@riftydev/net` scope; HMR bridge is its phase 1 acceptance
- ADR-0043 — Vite-in-Worker realm and cross-realm preview bridge
- ADR-0076 — cross-realm reverse VFS snapshot (the stream's remaining consumer)
- ADR-0080 — lazy `node_modules` remote-read (snapshot presence flag)
- ADR-0095 — dev-mode HMR routes through the cross-realm bridge
- ADR-0097 — preview frame port context routing (the `/preview/<port>/` route the iframe reloads against)
