# ADR 0164: Node 24 as the supported and parity-target version

Status: Accepted
Date: 2026-06-21

> TL;DR: `engines.node` + all CI/Netlify pins move `22`→`24`; Node 24 is now the single version rifty's parity gate proves against, so rifty must match Node-24 (not 22) observable behavior.

## Context

`engines` said `>=22` and every CI/Netlify job pinned `node-version: 22`, but the parity runner compares rifty against *whichever* Node executes it — i.e. the parity gold-standard was Node 22, while feature work + compat docs targeted "Node v24". The split is silently wrong: behavior that diverged across 22↔24 could pass locally (dev on 24) yet be measured against 22 in CI, or vice-versa. Concrete trip: `Dirent.path` (removed in 24, present in 22) — code/test written for 24, CI red on 22.

One version must be canonical. Picking it is a genuine, consumer-observable choice (raising `engines` is breaking for Node-22 users), so it is an ADR, not a CHANGELOG line. No prior ADR pinned a Node version.

## Decision

Node **24** is the supported floor and the parity target.
- `engines.node` = `>=24`; CI (`ci.yml`, `release.yml`, `ci-cross-browser.yml`), `netlify.yml`, `netlify.toml` pin `24`.
- "Maximally faithful to real Node" (mission) = faithful to **Node 24** — the version the parity runner runs in CI. New/changed surface is proven RED→GREEN vs Node 24.
- `process.versions.node` impersonation tracks the target (`24.0.0`); the impersonate-or-not honesty question stays open in `backlog/runtime-js/process-versions-node-honesty`.
- `@types/node` stays `^22.10.0` (forward-compatible for type-checking; not the runtime target) — bump deferred to avoid an unrelated lockfile/type churn.

## Consequences

- Single canonical version: parity measures what we ship; no 22↔24 dev/CI split.
- Breaking for consumers on Node 22 — acceptable (pre-1.0 pet project, Chromium-first scope).
- Node ≥ 24 satisfies npm-OIDC's ≥22.14.0 publish floor (release.yml).
- Follow-up: revisit `@types/node ^24` once a type sweep is budgeted; honesty ADR for `versions.node` still pending.
