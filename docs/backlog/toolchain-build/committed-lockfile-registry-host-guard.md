---
area: toolchain-build
status: ready
title: A repo check refuses any committed lockfile whose package addresses leave registry.npmjs.org
created: 2026-08-19
why: Three times (PR #266, #430, #443) a lock generated behind an internal mirror was committed with `resolved` on the mirror — unreproducible outside that network, mirror host leaked; no gate caught it.
sources: [PR #266 post-merge repair 2026-08-19, PR #430, PR #443, tests/e2e/npm-lock-replay.spec.ts]
code: [tools/checks/lockfile-registry.mjs, tools/checks/pr-check.mjs, .github/workflows/ci.yml]
---

## Context

Fault class `frozen-assumption` on the committed-fixture trust boundary: a lock
generated on a mirror-configured machine pins environment-specific state. The
root `.npmrc` protects only the repo's own `pnpm-lock.yaml`. Incidents:
`tests/e2e/fixtures/npm-lock-replay/vite8` (46/46, PR #266),
`docs/backlog/distribution/reference/isolate-library-probe/{deps,verify}`
(251, PR #430), `docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/deps`
(PR #443) — each repaired by rewriting the host, `integrity` unchanged, `npm ci`
against npmjs with an empty cache re-verified. The third was docs-only: heavy
CI lanes skip such a diff, so the check must ride a lane docs-only keeps.

## Challenge

challenge: 2026-11-25 — clear (class-kill repair of three observed incidents, no new direction; README §Challenge: existing-baseline repair)

## User scenario

A contributor whose npm points at an internal mirror runs `npm install` in a
probe under `docs/backlog/**/reference/**` and commits the lock. `pnpm pr:check`
(docs-only diff) and PR CI `lint-and-typecheck` fail naming the file, the
address count and the foreign host; the fix line says rewrite host to
`https://registry.npmjs.org`, keep `integrity`, re-verify with `npm ci`.

## Acceptance

1. Every lock carrier in every tracked/untracked-unignored path (`git ls-files`) is scanned: file locks `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`; and locks embedded in `.json`/`.json.gz` documents by one content rule (string under a lockfile-named key, or parsing as an object with `lockfileVersion`) — baked snapshots' `lockfile`, corpus seeds, evidence archives → scenario
2. An address off `https://registry.npmjs.org/` is red with carrier (file or `file#/json/pointer`), line count and host; funding/deprecation URLs and `file:` are not addresses; mutant per format and per historical path (test fixture, backlog `reference/`, baked snapshot) and a new `.json.gz` in an arbitrary directory are red (`tools/checks/lockfile-registry.test.ts`) → scenario
3. Declared exemptions pin path + sha256 of the file bytes; a new, changed or deleted exempt file is red; the check prints the exemption count; corpus rows equal their manifest `inputsSha256` → scenario
4. Runs in `pnpm pr:check` outside `SOURCE_LANES` (kept on a docs-only tree) and in CI `lint-and-typecheck` (no `if`, runs on docs-only PRs); a docs-only diff with a foreign lock under `docs/` is red in both → scenario
5. Current tree green: 19 exempt frozen files (14 corpus seeds, 5 evidence archives), no other violator → scenario

## Out of scope

- Rewriting the 19 exempt frozen files: `docs/backlog/distribution/agent-bench-corpus-mirror-lockfiles.md` (user-owned).
- Registry hosts inside packed tarballs of published packages: separate mechanism, see Decisions.
- Locks inside `.tgz` fixtures (upstream package bytes; none carries one today).

## Decisions

- Allowed host: one constant `https://registry.npmjs.org` — policy value, not a fetch target; no consumer needs a second public host (D-004 config not needed, REV-7).
- File discovery: `git ls-files --cached --others --exclude-standard`, never a disk walk.
- Embedded-lock rule by content form, not a path list: the next carrier kind needs no code change.
- Exemption anchor: sha256 of file bytes (equals corpus `inputsSha256`), not git blob id — working-tree exact, cross-checkable with the manifests.
- CI lane: existing unconditional `lint-and-typecheck` job; pr:check task not in `SOURCE_LANES`.
