# Compatibility matrix — package tooling CLIs

Hand-maintained public claim surface for real npm-installed tooling executed inside the rifty
browser shell. Rows cite the end-to-end package fixture, not host-side shortcuts.

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws
`NotImplementedError` or a documented unsupported command error).

| Feature | Status | Notes |
|---|---|---|
| `npm install` from `package.json` | ✅ | Installs registry `dependencies`/`devDependencies`/root `optionalDependencies` tarballs and honors `dist-tags.latest` for unconstrained specs |
| Required network acquisition without a configured registry | ❌ | Workbench snapshot-only and optional `InstallOptions.registry` keep local replay; required uncached metadata/tarballs throw `NotImplementedError('npm-client.registry.packument')` / `NotImplementedError('npm-client.registry.tarball')`. Eddy without registry rejects before callbacks. This host policy is separate from npm `--offline` |
| npm-authored `package-lock.json` replay | ⚠️ | Entry `optionalDependencies` replay through the shared cpu gate (native siblings skip with a warning, their lock-recorded subtrees preserved), lock-pinned `peerDependencies` traversal, loud `EBROKENLOCK unreached-entries` for entries no edge reaches. Proven end-to-end against real npm 11.17.0 locks: `vite@8.0.16` (47 entries, wasm32 rolldown binding + `vite build`) and a 6-package peer-only lock (module import). Recorded divergence: `npm ci` materializes parentless orphan lock entries verbatim; rifty refuses loudly — delete the lockfile and re-install |
| npm workspaces | ❌ | Non-workspace `package.json`/`node_modules` prefix discovery matches npm; `package.json#workspaces` at the selected or an ancestor root throws `NotImplementedError('npm.workspaces')` before install/script mutation because npm separates the root lock/tree prefix from the selected member manifest/lifecycle target; malformed declarations fail as `EWORKSPACESCONFIG`; `--workspaces=false` remains a loud unsupported flag |
| `npm` top-level command help | ✅ | `npm help` prints the browser npm subset and exits 0; bare `npm` / `-h` / `--help` print the same list with npm's usage exit 1; `npm help <topic>` is an explicit `NotImplementedError('npm.help.topic')` ceiling |
| Package lifecycle scripts | ❌ | Root `preinstall`/`install`/`postinstall`/`prepare` and registry tarball `preinstall`/`install`/`postinstall` throw `NotImplementedError('npm-client.lifecycle.<name>')`; registry tarball `prepare` metadata is ignored like npm's prepared package install path |
| Non-registry dependency specs | ❌ | `file:`/local paths, `workspace:`, git/GitHub shorthand, URL tarball, and npm-alias specs are explicit npm-client ceilings, not silently skipped. Gap: spellings npm-package-arg reads as alias/file/directory but rifty's classifier misses — uppercase `NPM:`, `*.tgz`/`*.tar(.gz)`, `@scope/pkg` — reach the registry path instead of this ceiling (`backlog/npm-client/dependency-spec-classifier-npa-kinds`) |
| `package.json#overrides` version/range/`latest` values | ✅ | npm's reading (ADR-0451; proven against npm 11.17.0 locks, incl. `{"vite": "8.0.16"}` under vitest 4.1.11 in the browser shell): a value npm reads as a version or range (node-semver loose grammar — `8.0.16`, `v8.0.16`, `^2`, `2.0.x`, `>=2.0.0 <2.1.0`, `\|\|` unions) or the tag `latest` is the overridden edge's spec, so native `ENATIVEUNSUPPORTED`, shadow recipes and baked redirects apply as for a declared `name@spec`; exact `''`/`*` keep the edge spec. Ranges then match through rifty's semver subset like every dependency spec (hyphen, `~>`, partial `>`/`<=` bounds, `^0.0.x`, loose-dropped tokens, empty `\|\|` branches → `No matching version` or another version). Not claimed: npm's `EOVERRIDE` for a root direct dependency; npm's nesting when re-resolving over an existing lock (the version matches) |
| `package.json#overrides` rifty spellings | ⚠️ | Extensions: `name@range` and a bare package name (npm: `EINVALIDTAGNAME` / a dist-tag) name a replacement package — the `incompatible-packages.md` escape hatch, exempt from the native gate; `npm:` aliases name a package (range-less `npm:x` keeps the edge range; npm `*`). Divergences: dist-tags other than `latest`, `@scope/pkg`, non-version tarball names (`vite-8.0.16.tgz`) and uppercase `NPM:` values read as package names; a version-shaped tarball name (`8.0.16.tgz`, npm: a file) reads as a range of the same package → `No matching version`. Classifier gap: `backlog/npm-client/dependency-spec-classifier-npa-kinds`; which reading wins for dist-tags, `@scope/pkg` and npm's `EOVERRIDE`: `backlog/npm-client/overrides-rifty-dialect-vs-npm` |
| `package.json#overrides` `$name` references and nested objects | ❌ | `$name` throws `NotImplementedError('npm-client.dependency-spec.override-reference')` before any registry read (npm resolves it against the root manifest); nested override objects throw `NotImplementedError('npm-client.package-json.overrides')` |
| `.bin` launcher execution | ✅ | Bare and explicit-path `prettier`/`eslint` resolve through the same nearest-ancestor command authority and run their launcher target in a supervised Node worker |
| Shell command discovery | ✅ | `which`, typo suggestions, and owner-backed Tab completion use the execution resolver's live registered + ancestor `.bin` inventory; `cd`/install changes are visible on the next request |
| Direct VFS Node entry | ⚠️ | Relative/absolute regular VFS files such as `./scripts/tool.mjs` run in the supervised Node-entry child with exact argv/cwd/stdio/exit. VFS has no POSIX execute bits; host PATH, native/WASI shebang selection, and non-Node executable semantics are not claimed |
| Non-string package-bin array entries | ❌ | Registry, lockfile, and direct linker ingress throw `NotImplementedError('npm-client.package-bin.non-string-array-entry')` before project-tree or lock mutation |
| Same-command package-bin settlement | ❌ | Collision-free scopes link; ambiguous current claims or a supplied authoritative-prior collision, owner transition, or removal throw `NotImplementedError('npm-client.bin-collision-reify')` before project-tree mutation; npm's operation-sensitive ADD/CHANGE/no-op/remove/rebuild ownership lifecycle remains unsupported |
| `npm run <script>` for non-dev scripts | ⚠️ | `format`, `format:check`, `lint`, typed lint, `pre<script>`/`post<script>` hooks, and forwarded args such as `npm run lint -- --fix` route through the same shell/.bin path. Script banner differs: rifty prints `> <command>` per step; npm prints a blank line, `> <name>@<version> <event>` (or `> <event>`), `> <command>` and a blank line — `backlog/npm-client/npm-run-script-banner` |
| Prettier baseline CLI | ✅ | `prettier --version`, `--write`, and `--check` over `.js`/`.ts` files |
| Prettier ESM config loading | ✅ | `prettier.config.mjs` is loaded through real dynamic import and affects output |
| ESLint flat config (`eslint.config.mjs`) | ✅ | ESM flat config loads through `file://`/dynamic import and reports real rule failures |
| ESLint fixer | ✅ | `eslint --fix` mutates the VFS file and a clean rerun exits successfully |
| Type-aware `typescript-eslint` | ✅ | Real `typescript@6.0.3` + `typescript-eslint@8.61.0` project-service linting reports typed rules |
| TTY/color formatter surface | ✅ | `util.styleText` + `stripVTControlCharacters` support ESLint's `stylish` formatter; terminal tests strip ANSI for assertions |
| Helper-spawning ESLint subcommands | ❌ | `eslint --init`, MCP/inspector helpers, and any path that expects host `npm`/`npx` child orchestration are not claimed |
| Native/binary toolchains | ❌ | Native packages remain unsupported unless shadow-substituted; see `incompatible-packages.md` |

## Test Sources

- `tests/e2e/owner-shell-prettier-eslint.spec.ts`
- `tests/e2e/command-resolver-discovery.spec.ts`
- `tests/browser-unit/owner-shell-routing.spec.ts`
- `tests/integration/npm-shell-prefix-parity.test.ts`
- `packages/workbench/src/glue/npm-shell-command.test.ts`
- `packages/workbench/src/workers/workbench-project-runtime.test.ts`
- `packages/workbench/src/glue/pty-client.test.ts`
- `apps/playground/src/adapters/playground-terminal-ui.contract.test.ts`
- `packages/workbench/src/workbench/project-terminal.test.ts`
- `packages/runtime-js/src/builtins/node-entry.test.ts`
- `tests/conformance/builtins/util.test.ts`
- `tests/conformance/builtins/fs-realpath-readdir.test.ts`
- `tests/conformance/builtins/readline.test.ts`
- `packages/io/src/streams/transform.test.ts`
- `packages/npm-client/src/installer.test.ts`
- `packages/npm-client/src/installer-lockfile.test.ts`
- `tests/e2e/npm-lock-replay.spec.ts`
- `tests/e2e/npm-override-bare-version.spec.ts`
- `packages/npm-client/src/overrides-npm-value.contract.test.ts`
- `packages/npm-client/src/installer-override-npm-value.contract.test.ts`
- `packages/npm-client/src/installer-override-npm-value-policy.contract.test.ts`

## Known Limitations

- This page claims real Prettier/ESLint package workflows in the browser shell, not adoption of
  Prettier/ESLint as this repository's own lint/format stack. The repository still uses Biome unless
  superseded by a separate ADR.
- Third-party Prettier plugins are not claimed by this matrix until covered by a dedicated
  real-package fixture; pure-JS plugins are expected to use the same VFS/dynamic-import path, while
  native helpers remain subject to the package policy.
- Runtime-built `import()` is claimed for lexical `Function` constructors created inside
  rifty-loaded modules. A tool that deliberately uses `globalThis.Function` in a
  rifty-loaded module hits the directed global-Function ceiling documented in
  `modules.md`; derived constructors (`fn.constructor`, `Function.prototype.constructor`)
  that compile possible `import()` source hit
  `module-loader.function-constructor-derived-host`. Async/generator constructors
  or pre-captured host constructors remain outside the routing claim. Nested
  runtime-built `Function("... import(...) ...")` sources throw
  `module-loader.function-constructor-dynamic-scope` instead of falling through
  to host import.
