# ADR 0433: Preserve Vite module URLs at the filesystem root

Status: Accepted
Date: 2026-09-13

## Context

PR-333 live React edit builds, but its input never appears. Native browser
responses prove two byte-identical Refresh modules: /@react-refresh (HTML
preamble) and /@id//@react-refresh (component import). Vite hot-updates the new
component; its registration uses a different runtime from React's renderer.

Vite 7.3.6's normalizeResolvedIdToUrl slices root.length from matching ids.
For root / this removes their URL-leading slash and falls through to wrapId.
Executed upstream function: /@react-refresh at an ordinary root, but
/@id//@react-refresh at /. Native Node/Vite/React same component edit before
and after build updates in-place with one Refresh URL. Browser RED carries
both phases; no special model behavior or full reload closes the result.

## Decision

Extend ADR-0384's existing registry-owned Vite bundle preparation with one exact
root-slice repair: preserve the leading slash when root is /; leave other roots
unchanged. Applies to all resolved module ids, not only React or this template.
One original/prepared anchor is required; missing/duplicate input fails loudly.
Existing Vite 7/8 bundles carry it beside the root-watcher anchor. Acquisition
and trusted-entry validation own the prepared bytes; recipe identity includes
the policy and snapshots use the existing producer. No live URL rewrite layer.

## Alternatives and sweep

- Change logical project root/cwd: would change ADR-0165 and existing programs
  for an upstream string-slice edge case.
- Reload the preview or rewrite React imports: conceals broken component/module
  identity and loses state. Rejected.
- Fix Node path/fs primitives: actual upstream function reproduces on Node;
  the bad value is created by this string slice, not those primitives.
- Resolved source/dependency/virtual ids share the same normalization owner.
  Other root-relative paths (public-file middleware, build output) are separate
  call sites; this repair neither changes nor approximates them.

## Proof

Node 24.16.0, Vite 7.3.6, plugin-react 5.2.0, React 19.2.8.
Raw commands/results and root-slice/native browser evidence:
`docs/backlog/playground/reference/ai-mode-chat-evidence.md`.
