# Map — isolate-host-npm-delivery

## Items

Seeded at FIT. Order: platform CI job(s) running `tests/packed-consumer.test.ts` → docs (README
platforms + upgrade rule; `docs/public/publishing.md` counts 17 packages, the filter publishes 19
with the two isolate names) → first publication of the three new names (user, token) and trusted
publisher setup → the tag release → a CI check installing from the registry.

## Open questions

- Supported platforms CI must prove: linux-x64 glibc (requirements §8 acceptance), plus musl
  (alpine) and/or arm64 — owner: user — isolated-vm 7.0.2 ships prebuilds for linux-x64/arm64
  (glibc and musl, abi137 = Node 24), darwin-arm64, win32-x64; today only ubuntu x64 runs the tests.
- First publication of `@riftydev/isolate-host`, `@riftydev/isolate-guest` and the agent tools' core package with an npm token
  (`tools/publishing/first-publish.sh --only`, then `setup-trusted-publishers.sh`, an interactive
  `npm login`) — owner: user — publishing is confirm-first (`AGENTS.md` §Confirm-first); OIDC cannot
  create a name.
- When to cut the release: now (live sandbox + `runCode`) or after the template goal — owner: user.

## Out of scope

- Windows support claims (prebuild exists, untested); building isolated-vm from source on other
  platforms.
- The consumer's outer boundary (uid, container, cgroup, secrets): README §Security, the
  consumer's duty.
