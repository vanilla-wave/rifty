---
area: vfs
status: draft
title: Firefox 114 beta saved source is missing after acknowledged OPFS flush and reload
created: 2026-09-28
why: the measured beta floor boots and builds successfully but the same namespace reopens without the saved source despite a flushed receipt
sources: [docs/backlog/vfs/reference/firefox114-beta-reopen-missing-bytes.json, ADR-0469, ADR-0477]
code: [apps/playground/browser-support.js, packages/vfs/src/boot.ts, packages/vfs/src/opfs-replica-store.ts, tools/floor-lane/run.mjs]
---

## Context

Finding, browser-support-floor I7 record-only discovery. Run
`floor-firefox-2026-09-27T22:56:02.379Z`, source revision
`850eeee2640aae0793c5c629994acd20821cbf95` plus PR #362 working tree,
Playwright 1.34.3, macOS arm64. UA reports Firefox114.0; the measured pin is
**114.0b3 beta** (ADR-0477), not stable114 certification.

Raw artifact: support OPFS passed; boot backend `opfs`; seed/install/build passed
(Vite exit0, expected HTML); flush `{applied:"yes",persistence:"flushed"}`;
reload changes `performance.timeOrigin`; reopen boot backend `opfs`; then
`reopen-saved-bytes` rejects `VfsError: ENOENT: /floor-proof/main.js`.
No page errors. Report keeps namespace
`browser-floor-e1d8a120-7573-4e30-9208-d921007973a0`; storage estimate usage
30088796 bytes. Existence/contents of the native replica after failure were not
inspected: physical data loss, replay failure and other causes remain unproven.

Carrier review: `browser-support.js` writes `/floor-proof/main.js`, awaits build
and flush, saves the report (including namespace) to sessionStorage, disposes,
reloads, boots with that namespace, and reads the same path before reopening the
toolchain project. No namespace/path switch or storage deletion found. This is a
product-level failure observation, not an identified root cause or a stable114
claim. A fresh isolated rerun and native-state inspection are pickup work.

User path: run persistent sandbox on `/browser-support.html`; automatic reload
reaches missing-source failure. Carrier recipe: `tools/floor-lane/README.md`,
Firefox beta pin ADR-0477; raw source JSON retains every step and receipt.

Compat: measured Firefox114 beta floor **❌ reopen-saved-bytes**; stable114 remains
unmeasured. Matrix owner: `docs/public/compat/browsers.md`.

## Executed command

```sh
node tools/floor-lane/run.mjs --engine firefox --runner /tmp/rifty-browser-floor-data/node_modules/playwright-114 --executable-path /tmp/rifty-firefox114-native/firefox/Nightly.app/Contents/MacOS/firefox --url http://127.0.0.1:5611/browser-support.html --output /tmp/pr362-floor114-native.json
```

The launcher used official pinned browser archives. The Firefox executable was
extracted with native tooling after the Node24 archive extractor truncated it;
this artifact predates the runner's observed-build/channel fields. Subsequent
canonical-run evidence must retain the beta qualification.

## Canonical default-run confirmation

Raw artifact: `docs/backlog/vfs/reference/firefox114-beta-reopen-missing-bytes-canonical.json`. Same product outcome reproduced with automatic pinned
runner/browser installation, without runner/executable overrides:

```sh
node tools/floor-lane/run.mjs --engine firefox --url http://127.0.0.1:5611/browser-support.html --output /tmp/pr362-floor114-canonical.json
```

reopen-saved-bytes: same ENOENT after flushed receipt; reported build114.0, explicit 114.0b3 beta channel, runner1.34.3.
Runtime sources were at `850eeee2640aae0793c5c629994acd20821cbf95`; runner repairs
were still uncommitted after that revision. The earlier override-based artifact
remains history. This confirms the observation, not a root cause or broader
version range.

## Classification

Storage reopen boundary; `provenance-lie` candidate: acknowledged flush does not
match subsequent readback. `torn-state` or platform persistence semantics are
hypotheses, not established fault causes. No transport reorder/duplicate or new
coordination mechanism proposed.

Dedup 2026-09-28: backlog titles/code + traps + declined concepts searched for
Firefox114/reload/reopen/ENOENT. I3 missing-createWritable finding differs:
here native OPFS probe, writes, build and flush all pass. No matching finding.

## Decisions

- 2026-09-28 — capture only; I7 records floor product reds. Owner: vfs; trigger: investigate Firefox114 beta persistence on pickup; no repair or new mechanism selected.
