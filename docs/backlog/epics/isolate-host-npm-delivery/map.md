# Map — isolate-host-npm-delivery

## Items

Seeded at FIT, when the user starts it (Decisions, 2026-11-25). Order: docs (README platforms +
upgrade rule; `docs/public/publishing.md` counts 17 packages, the filter publishes 19 with the two
isolate names) → `@riftydev/isolate-guest` and the tools' core out of the publish filter → first
publication of `@riftydev/isolate-host` (user, token: `tools/publishing/first-publish.sh --only`,
then `setup-trusted-publishers.sh`) → the tag release → a CI check installing from the registry.

## Open questions

- When to start — owner: user — «когда-нибудь попозже» (2026-11-25); the goal stays draft until then.

## Out of scope

- Windows support claims (prebuild exists, untested); building isolated-vm from source on other
  platforms.
- The consumer's outer boundary (uid, container, cgroup, secrets): README §Security, the
  consumer's duty.
