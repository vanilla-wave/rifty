---
kind: epic
status: draft
title: Isolate host on npm — `npm install @riftydev/isolate-host` in a clean Node 24 project, no compiler, `createSandbox` works
created: 2026-11-24
value: A service installs the isolate host from npm with provenance, on linux-x64 (glibc) without a C++ toolchain, instead of building a tarball from a rifty checkout.
user_story: As a Node service deploying the isolate host, I want `npm install @riftydev/isolate-host` from the registry, but today the name is E404 and the README installs a tarball packed from a rifty checkout.
---

## Outcome

`@riftydev/isolate-host` is on npm with provenance, published by the tag release
(`.github/workflows/release.yml`, OIDC). `npm install @riftydev/isolate-host` in a clean project on
Node 24, linux-x64 glibc, needs no compiler, and the README's `runCode` / `createSandbox` snippets
run from the installed package — proven in CI from the registry tarball. The README lists the
platform CI proves (linux-x64 glibc), those it does not (musl, arm64, darwin, Windows — prebuilds
exist, untested) and the upgrade rule (Node / V8 point releases).

## User scenario

1. On a clean linux-x64 (glibc) machine, `npm init -y && npm install @riftydev/isolate-host`
   completes without a compiler (isolated-vm's prebuild loads).
2. The README's `runCode` and `createSandbox` snippets print what the README says.
3. `npm view @riftydev/isolate-host` shows the release's version with a provenance attestation.
4. The README names the platforms CI proves, those not proven, and when to upgrade Node.

## Invariants

<!-- Drafted at FIT after the platform question (map.md). False on main @ b3731e9c0:
`npm view @riftydev/isolate-host` → E404, `@riftydev/isolate-guest` → E404 (requirements §8,
checked 2026-11-24); README:15-25 installs a packed tarball; isolate-host tests run only on
ubuntu-24.04 x64 (ci.yml:89-112); no alpine/arm64 job. -->

## Challenge

challenge: pending

## Decisions

- 2026-11-24 — agent: `@riftydev/isolate-guest` stays a separate public package (ADR-0558, custom embedders); the host bundles its bytes and does not depend on it at runtime (`scripts/build-runtime.mjs`), so the host installs without it.
- 2026-11-25 — user: «оставляем ее» (F6, «В CI сейчас только ubuntu x64») — CI proves linux-x64 glibc only; other platforms are named untested in the README.
- 2026-11-25 — user: «давай пока только host публиковать и то когда-нибудь попозже» (F7, the first npm publication of new names with a token) — only `@riftydev/isolate-host`, not now: this goal waits for the user's go; `@riftydev/isolate-guest` and the agent tools' core stay off npm (kept out of the release's publish filter until their own first publication, else a tag release tries to publish a name OIDC cannot create). The release timing question (F8) closes with it.
