---
kind: epic
status: draft
title: Isolate host on npm — `npm install @riftydev/isolate-host` in a clean Node 24 project, no compiler, `createSandbox` works
created: 2026-11-24
value: A service installs the isolate host (and its agent tools) from npm with provenance, on its deployment platform without a C++ toolchain, instead of building a tarball from a rifty checkout.
user_story: As a Node service deploying the isolate host, I want `npm install @riftydev/isolate-host` from the registry, but today the name is E404 and the README installs a tarball packed from a rifty checkout.
---

## Outcome

`@riftydev/isolate-host` and `@riftydev/isolate-guest` are on npm with provenance, published by
the tag release (`.github/workflows/release.yml`, OIDC). `npm install @riftydev/isolate-host` in a
clean project on Node 24 on each supported platform needs no compiler, and the README's
`runCode` / `createSandbox` snippets run from the installed package — proven in CI from the
registry tarball, per platform. The agent tools ship in the same release, version-locked to the
host. The README lists the supported platforms (musl's status included) and the upgrade rule
(Node / V8 point releases).

## User scenario

1. On a clean machine of the deployment platform, `npm init -y && npm install @riftydev/isolate-host`
   completes without a compiler (isolated-vm's prebuild loads).
2. The README's `runCode` and `createSandbox` snippets print what the README says.
3. `npm view @riftydev/isolate-host` shows the release's version with a provenance attestation.
4. The agent tools of the same release import in plain Node and run over that sandbox.
5. The README names the platforms CI proves, those not proven, and when to upgrade Node.

## Invariants

<!-- Drafted at FIT after the platform question (map.md). False on main @ b3731e9c0:
`npm view @riftydev/isolate-host` → E404, `@riftydev/isolate-guest` → E404 (requirements §8,
checked 2026-11-24); README:15-25 installs a packed tarball; isolate-host tests run only on
ubuntu-24.04 x64 (ci.yml:89-112); no alpine/arm64 job. -->

## Challenge

challenge: pending

## Decisions

- 2026-11-24 — agent: `@riftydev/isolate-guest` stays a separate public package (ADR-0558, custom embedders); the host bundles its bytes and does not depend on it at runtime (`scripts/build-runtime.mjs`), so it ships in the same release, not as a dependency.
- 2026-11-24 — agent: no new name for the agent tools (`epics/isolate-host-agent-tools` Decisions: a subpath export), so the token action covers two names.
