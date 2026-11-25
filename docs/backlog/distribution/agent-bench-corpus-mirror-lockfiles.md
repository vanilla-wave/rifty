---
area: distribution
status: draft
title: Frozen bench corpus seeds and evidence archives pin locks on an internal mirror
created: 2026-11-25
why: 19 frozen files embed package-locks whose `resolved` sits on an internal npm mirror — host leaked, bytes not replayable as-is outside that network; the lockfile guard exempts them by sha256 until the user decides.
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
  `tools/agent-bench/corpus/core-v1.json` (6 cases) and `boundary-v1.json` (8);
  "same inputs/locks as eval-v18". Reports citing those hashes:
  `tools/agent-bench/reports/summaries/2026-10-15-eval-v18-corrected`,
  `2026-11-23-pi-0.85.1-baseline`, `2026-11-23-pi-1.6.0-upgrade`.
- Evidence archives (5), recorded runs — never rewritten, exempt until deleted:
  `docs/backlog/distribution/reference/agent-bench-baseline-native.json.gz`
  (`finalDiff` before/after), `docs/backlog/distribution/reference/agent-eval-csv-export-controls-data.json.gz`,
  `tools/agent-bench/reports/summaries/{2026-09-13-gpt-5.6-sol,2026-09-27-gpt-6-luna-baseline,2026-09-28-gpt-6-luna-rerun}/source-artifacts.json.gz`.

Functional impact: not measured. Seeds are installed in rifty lanes via
`npm install` against `registryUrl: '/npm-registry'`
(`tools/agent-bench/src/lanes/rifty.ts`, `no-coi-page.ts`) and in native
lanes; whether either fetches the lock's `resolved` host (and so fails outside
the mirror's network) is unverified. Known harm: mirror host in committed bytes.

## Question

Rewrite the 14 seed hosts to `https://registry.npmjs.org` now (new
`inputsSha256`/`lockSha256` in both manifests, prior reports' byte identity
becomes historical), or wait for the next corpus version
(`docs/backlog/distribution/agent-bench-contract-first-corpus.md`) and drop the
rows then? Owner: user.

Whoever rewrites must measure, not assume:

- `integrity` unchanged; `npm ci --cache <empty> --registry=https://registry.npmjs.org/`
  fetches every tarball and matches.
- Open fork (claim, no artifact yet): npm's `replace-registry-host` default
  (`npmjs`) swaps only the npmjs host for the configured `--registry`. If so,
  seeds rewritten to npmjs start being redirected to the bench's local
  registry, where today mirror-host URLs may be fetched as-is — the bench's
  `npm ci --registry=<local>` behaviour can change. Probe both lock forms
  against the local registry before landing.
- Drop the matching `EXEMPT` rows in the same change (the guard refuses a stale row).
