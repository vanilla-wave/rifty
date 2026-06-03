# @riftydev/npm-client

In-browser npm installer.

Pieces:

- **`resolver`** — semver matching: `1.x`, `^1.2.3`, `~1.2`, `>=1.0.0 <2.0.0`, exact, dist-tags.
- **`registry`** — `RegistryClient` with a pluggable fetcher (real `fetch` for live use, mock fetcher for tests).
- **`unpacker`** — gzip + tar extraction into the VFS.
- **`linker`** — builds a deduplicated `node_modules` tree, writes a lockfile.
- **`overrides`** — applies the shadow registry (D-005) before resolution.

## Why none of this hits the live registry in tests

We pin a mock fetcher in the test harness. Real-network installs are exercised manually; CI uses fixtures. This matches D-004's contract.
