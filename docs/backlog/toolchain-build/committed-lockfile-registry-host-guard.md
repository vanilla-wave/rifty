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
probe under a backlog `reference/` directory and commits the lock. `pnpm pr:check`
(docs-only diff) and PR CI `lint-and-typecheck` fail naming the file, the
address count and the foreign host; the fix line says rewrite host to
`https://registry.npmjs.org`, keep `integrity`, re-verify with `npm ci`.

## Acceptance

1. Every lock carrier in every tracked path (`git ls-files --cached`, staged included; regular files only) is scanned: file locks `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`; and locks embedded in `.json`/`.json.gz` documents by one content rule — at any depth an object with `lockfileVersion`, any value under a lockfile-named key, or a string parsing as an object with `lockfileVersion` (baked snapshots' `lockfile`, corpus seeds, probe outputs, evidence archives) → scenario
2. An address off the allowed set is red with carrier (file or `file#/json/pointer`), line count and `scheme//host`; the npmjs origin is compared on the parsed URL (host suffix, userinfo, foreign port red; `:443`, host case pass); funding/deprecation URLs, `file:`, `github:o/x#sha` are not addresses; git dependencies red with their own reason; unparseable lock by name red; mutants per format, per historical path, object locks, a new `.json.gz` in an arbitrary directory are red (`tools/checks/lockfile-registry.test.ts`) → scenario
3. Declared exemptions pin path + sha256 of the file bytes; a new, changed or deleted exempt file is red; the check prints the exemption count and the skipped-unparseable count; corpus rows equal their manifest `inputsSha256` → scenario
4. Runs in `pnpm pr:check` outside `SOURCE_LANES` (kept on a docs-only tree) and in CI `lint-and-typecheck` (no `if`, runs on docs-only PRs); a docs-only diff with a foreign lock under `docs/` is red in both → scenario
5. Current tree green: 19 exempt frozen files (14 corpus seeds, 5 evidence archives), no other violator → scenario

## Out of scope

- Rewriting the 19 exempt frozen files: `docs/backlog/distribution/agent-bench-corpus-mirror-lockfiles.md` (user-owned).
- Registry hosts inside packed tarballs of published packages: separate mechanism, `docs/backlog/toolchain-build/packed-tarball-registry-host-guard.md`.
- Declared limits, not read (none present in the tree 2026-11-26):
  - pnpm/yarn-berry YAML beyond the line-wise form (keyed line, quoted key, block scalar): no YAML parser reachable from `tools/checks` (`yaml` is only a `packages/agent` dependency), no new dependency.
  - `bun.lock`/`bun.lockb`, `deno.lock`.
  - Registry settings in `.yarnrc.yml` / `.npmrc` fixtures (config, not addresses).
  - `.jsonl`, `.zip`/`.tar` documents.
  - `.tgz` fixtures (upstream package bytes; none carries a lock).
  - A lock encoded twice (JSON string of a JSON string).
  - Protocol-relative `//host/…` addresses.
  - Untracked files (contract is committed bytes).

## Decisions

- Allowed: `https://registry.npmjs.org` (parsed URL: scheme, host, default port, no userinfo) — policy value, not a fetch target; no D-004 config (AGENTS.md §Simplicity).
- 2026-11-26, manager decision: also allowed by rule (not exemptions) — loopback (`127.0.0.0/8`, `[::1]`, `localhost`) and the `.test` zone (RFC 6761): cannot be a mirror, disclose nothing (probe outputs on `127.0.0.1:<port>`, shadow fixture on `registry.test`). `.invalid`/`.example`/`.internal` stay red.
- Git dependencies (`git+ssh://`, `git+https://`, pnpm `repo:`) red whatever the host: the host may be internal. `github:o/x#sha` carries no host, passes.
- 2026-11-26, manager decision: tracked paths only (`git ls-files --cached`) — untracked agent junk would make local red while CI is green.
- Embedded-lock rule by content form, not a path list: the next carrier kind needs no code change.
- Exemption anchor: sha256 of file bytes (equals corpus `inputsSha256`), not git blob id — working-tree exact, cross-checkable with the manifests.
- CI lane: existing unconditional `lint-and-typecheck` job; pr:check task not in `SOURCE_LANES`.
