---
area: distribution
status: draft
title: Frozen bench corpus seeds and evidence archives pin locks on an internal mirror
created: 2026-11-25
why: 19 frozen files embed package-locks whose `resolved` sits on an internal npm mirror — host leaked, replay outside that network unverified; the lockfile guard exempts them by sha256 until the user decides.
sources: [PR #465, tools/checks/lockfile-registry.mjs, docs/backlog/toolchain-build/committed-lockfile-registry-host-guard.md]
code: [tools/checks/lockfile-registry.mjs, tools/agent-bench/corpus/core-v1.json, tools/agent-bench/corpus/boundary-v1.json]
---

## Context

Finding. `pnpm check:lockfile-registry` (PR #465) scans locks embedded in
`.json`/`.json.gz` and finds 19 frozen files with `resolved` on an internal
mirror (no other violator in the tree). They sit in its `EXEMPT` list (path +
sha256 of the bytes; changed/deleted bytes fail the row).

- Corpus seeds (14): `tools/agent-bench/corpus/cases/*/project.json`, key
  `package-lock.json`. Bytes pinned by `inputsSha256`/`lockSha256` in
  `tools/agent-bench/corpus/core-v1.json` (6 cases; its `purpose`: "same
  inputs/locks … as eval-v18") and `boundary-v1.json` (8). Reports citing the
  `lockSha256` values:
  `tools/agent-bench/reports/summaries/2026-10-15-eval-v18-corrected`,
  `2026-11-23-pi-0.85.1-baseline`, `2026-11-23-pi-1.6.0-upgrade`.
- Evidence archives (5), recorded runs — never rewritten, exempt until deleted:
  `docs/backlog/distribution/reference/agent-bench-baseline-native.json.gz`
  (`finalDiff` before/after), `docs/backlog/distribution/reference/agent-eval-csv-export-controls-data.json.gz`,
  `tools/agent-bench/reports/summaries/{2026-09-13-gpt-5.6-sol,2026-09-27-gpt-6-luna-baseline,2026-09-28-gpt-6-luna-rerun}/source-artifacts.json.gz`.

Outside the guard (prose, not locks), the same host in committed bytes
(sweep 2026-11-26: `git grep` + every tracked `.json.gz`):
`tools/agent-bench/reports/summaries/{2026-10-15-eval-v18-corrected,2026-11-23-pi-0.85.1-baseline,2026-11-23-pi-1.6.0-upgrade}/report.json.gz`
(`resolved` lines in `/runs/N/terminalTail`), `CHANGELOG.md:582`,
`docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md:44`.

Functional impact: not measured. Native lanes write the seed and run a bare
`npm install --no-audit --no-fund` (`tools/agent-bench/src/lanes/local-reference.ts:35`,
no `--registry`: the user's `.npmrc` applies); rifty lanes type `npm install`
in the rifty terminal (`lanes/rifty.ts:82`; no-COI lane: `registryUrl:
'/npm-registry'`, `no-coi-page.ts:39,55`). Whether a native install outside the
mirror's network fails on the lock's `resolved` host is unverified. Known harm:
mirror host in committed bytes.

## Question

Scope of the answer: every place above that names the host in committed bytes
(19 exempt files, 3 report archives, 2 prose lines) — not only the locks.
Rewrite the 14 seed hosts to `https://registry.npmjs.org` now (new
`inputsSha256`/`lockSha256` in both manifests, prior reports' byte identity
becomes historical), or wait for the next corpus version
(`docs/backlog/distribution/agent-bench-contract-first-corpus.md`) and drop the
rows then? Owner: user.

Whoever rewrites must measure, not assume:

- `integrity` unchanged; `npm ci --cache <empty> --registry=https://registry.npmjs.org/`
  fetches every tarball and matches.
- Open fork (claim, no artifact yet): npm's `replace-registry-host` default
  (`npmjs`) rewrites only npmjs-host `resolved` URLs to the configured
  registry. If so, today a native install fetches the mirror URLs as written,
  and after a rewrite it follows the user's `.npmrc` registry — the native
  lanes' install source changes either way. Probe the native `npm install`
  with both lock forms, with and without a mirror `.npmrc`, before landing.
- Drop the matching `EXEMPT` rows in the same change (the guard refuses a stale row).
