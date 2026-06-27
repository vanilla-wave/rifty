# @riftydev/npm-client

In-browser npm installer.

Pieces:

- **`resolver`** — semver matching: `1.x`, `^1.2.3`, `~1.2`, `>=1.0.0 <2.0.0`, exact, dist-tags.
- **`registry`** — `RegistryClient` with a pluggable fetcher (real `fetch` for live use, mock fetcher for tests).
- **`unpacker`** — gzip + tar extraction into the VFS.
- **`linker`** — builds a deduplicated `node_modules` tree, writes a lockfile.
- **`overrides`** — applies the shadow registry (D-005) before resolution.

`install({ vfs, cwd, registry })` reads `<cwd>/package.json` and installs
`dependencies`, `devDependencies`, and optional root dependencies, applying
string-valued `overrides`. The older explicit form
`install(name, version, deps, opts)` still works for callers that already have a
dependency map. Installed package `bin` metadata becomes launcher shims in the
containing `node_modules/.bin` scope; the playground shell now resolves those
shims through its PATH-style `.bin` lookup and runs them in supervised Node
workers. Non-registry specs such as `file:`/local paths, `workspace:`,
git/GitHub shorthand, URL tarballs, and npm aliases throw named
`NotImplementedError`s instead of pretending to work. Registry packages declaring install lifecycle scripts (`preinstall`,
`install`, `postinstall`) throw named `NotImplementedError`s; registry tarball
`prepare` metadata is ignored because npm does not run it for registry
dependency installs. Script execution is tracked separately from registry
resolution/linking.

## Why none of this hits the live registry in tests

We pin a mock fetcher in the test harness. Real-network installs are exercised manually; CI uses fixtures. This matches D-004's contract.
