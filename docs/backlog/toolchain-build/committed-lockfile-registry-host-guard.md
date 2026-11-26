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
2. One verdict function (`classifyAddress`) takes the whole value of an address key (`resolved`/`tarball`/`resolution`/`repo`; text locks: the whole value after the key in canonical notation — plain or quoted, keyed line or flow entry; any other notation red as non-canonical) and parses it with WHATWG `URL`, as npm does. Red with carrier (file or `file#/json/pointer`), line count and `scheme//host`: off the allowed set (host suffix, userinfo incl. `registry.npmjs.org'x@evil…` / `}@evil…`, `https:evil…`, `https:\\evil…`, foreign port; `:443`, host case pass); git dependencies with their own reason; a value that is no URL nor a declared non-network form (`file:`, `link:`, `workspace:`, `github:`, `rifty:`, berry `npm:`/local protocols, relative path) — e.g. `//host/…` — as unreadable; git scp form `git@host:…` as git; unparseable lock by name; unparseable `.json` with lock markers. Mutants per format, per historical path, object locks, a new `.json.gz` in an arbitrary directory are red (`tools/checks/lockfile-registry.test.ts`) → scenario
3. Declared exemptions pin path + sha256 of the file bytes; a new, changed or deleted exempt file is red; the check prints the exemption count; corpus rows equal their manifest `inputsSha256` → scenario
4. Runs in `pnpm pr:check` outside `SOURCE_LANES` (kept on a docs-only tree) and in CI `lint-and-typecheck` (no `if`, runs on docs-only PRs); a docs-only diff with a foreign lock under `docs/` is red in both → scenario
5. Current tree green: 19 exempt frozen files (14 corpus seeds, 5 evidence archives), no other violator → scenario

## Out of scope

- Threat model: the check catches locks written by package managers (the class of the three incidents); a deliberately hand-crafted bypass is not its model. A further "hand-written form no package manager writes passes green" finding is a declared limit (one line here), not a new round (manager, 2026-11-26).
- Rewriting the 19 exempt frozen files: `docs/backlog/distribution/agent-bench-corpus-mirror-lockfiles.md` (user-owned).
- Registry hosts inside packed tarballs of published packages: separate mechanism, `docs/backlog/toolchain-build/packed-tarball-registry-host-guard.md`.
- Declared limits, not read (none present in the tree 2026-11-26):
  - YAML is not parsed (`yaml` is only a `packages/agent` dependency; no new dependency): text locks are read in canonical form only, any other notation around an address key is red (see Decisions).
  - Yarn berry `patch:` with a nested descriptor: passes as a local protocol, the nested descriptor is not inspected.
  - `gitlab:` / `bitbucket:` / `gist:` shorthands: red as unreadable while `github:` passes.
  - `bun.lock`/`bun.lockb`, `deno.lock`.
  - Registry settings in `.yarnrc.yml` / `.npmrc` fixtures (config, not addresses).
  - `.jsonl`, `.zip`/`.tar` documents.
  - `.tgz` fixtures (upstream package bytes; none carries a lock).
  - A lock encoded twice (JSON string of a JSON string).
  - A symlink named as a lock: not followed; its target is read only if itself a carrier.
  - Size: each document is read and parsed whole (a 65 MB JSON costs memory/time; past V8's string limit it fails red).
  - Untracked files (contract is committed bytes); bytes come from the working tree at index paths (trap `lockfile-mirror-host`).

## Decisions

- Allowed: `https://registry.npmjs.org` (parsed URL: scheme, host, default port, no userinfo) — policy value, not a fetch target; no D-004 config (AGENTS.md §Simplicity).
- 2026-11-26, manager decision: also allowed by rule (not exemptions) — loopback (`127.0.0.0/8`, `[::1]`, `localhost`) and the `.test` zone (RFC 6761): cannot be a mirror, disclose nothing (today 4 carriers / 5 addresses: 2 probe outputs on `127.0.0.1:<port>`, shadow fixture on `registry.test`). `.invalid`/`.example`/`.internal` stay red.
- 2026-11-26, manager decision: the whole address value is parsed by `URL` in one function; a pattern only locates the value in text locks. An address value that parses to no host and is no declared non-network form is red, never "not an address". `rifty:` (npm-client shadow-substitution identity) is a declared non-network form.
- 2026-11-26, manager decision (replaces line-wise interpretation of YAML): `pnpm-lock.yaml` / `yarn.lock` are accepted only in the form the package manager writes — address value plain (not `! & * | > [`) or quoted without escapes (`\` in "…", `''` in '…'), non-empty, on the key's line; key bare/`'…'`/`"…"`. Explicit key `?`, tag, anchor, alias, block scalar, value on the next line, continuation line, mapping as value, escapes → red "non-canonical — regenerate the lock with its package manager".
- Git scp form `user@host:path` (no scheme) is a git dependency (red), not a relative path.
- 2026-11-26, manager decision (replaces skip-and-count): an unparseable `.json` with lock markers is red — no pass through JSONC/trailing comma/`NaN`.
- Git dependencies (`git+ssh://`, `git+https://`, pnpm `repo:`) red whatever the host: the host may be internal. `github:o/x#sha` carries no host, passes.
- 2026-11-26, manager decision: tracked paths only (`git ls-files --cached`) — untracked agent junk would make local red while CI is green.
- Embedded-lock rule by content form, not a path list: the next carrier kind needs no code change.
- Exemption anchor: sha256 of file bytes (equals corpus `inputsSha256`), not git blob id — working-tree exact, cross-checkable with the manifests.
- CI lane: existing unconditional `lint-and-typecheck` job; pr:check task not in `SOURCE_LANES`.
