# Compatibility matrix — package tooling CLIs

Hand-maintained public claim surface for real npm-installed tooling executed inside the rifty
browser shell. Rows cite the end-to-end package fixture, not host-side shortcuts.

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws
`NotImplementedError` or a documented unsupported command error).

| Feature | Status | Notes |
|---|---|---|
| `npm install` from `package.json` | ✅ | Installs registry `dependencies`/`devDependencies`/root `optionalDependencies` tarballs and honors `dist-tags.latest` for unconstrained specs |
| `npm` top-level command help | ✅ | `npm help` prints the browser npm subset and exits 0; bare `npm` / `-h` / `--help` print the same list with npm's usage exit 1; `npm help <topic>` is an explicit `NotImplementedError('npm.help.topic')` ceiling |
| Package lifecycle scripts | ❌ | Root `preinstall`/`install`/`postinstall`/`prepare` and registry tarball `preinstall`/`install`/`postinstall` throw `NotImplementedError('npm-client.lifecycle.<name>')`; registry tarball `prepare` metadata is ignored like npm's prepared package install path |
| Non-registry dependency specs | ❌ | `file:`/local paths, `workspace:`, git/GitHub shorthand, URL tarball, and npm-alias specs are explicit npm-client ceilings, not silently skipped |
| `.bin` launcher execution | ✅ | Bare `prettier`/`eslint` resolve through `node_modules/.bin` and run in a supervised Node worker |
| `npm run <script>` for non-dev scripts | ✅ | `format`, `format:check`, `lint`, typed lint, `pre<script>`/`post<script>` hooks, and forwarded args such as `npm run lint -- --fix` route through the same shell/.bin path |
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
- `apps/playground/src/glue/npm-shell-command.test.ts`
- `apps/playground/src/glue/pty-client.test.ts`
- `apps/playground/src/adapters/terminal-manager.test.ts`
- `packages/runtime-js/src/builtins/node-entry.test.ts`
- `tests/conformance/builtins/util.test.ts`
- `tests/conformance/builtins/fs-realpath-readdir.test.ts`
- `tests/conformance/builtins/readline.test.ts`
- `packages/io/src/streams/transform.test.ts`
- `packages/npm-client/src/installer.test.ts`

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
