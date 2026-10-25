# ADR 0545: Execute local npx binaries through the existing command resolver

Status: Accepted
Date: 2026-10-20

## Context

esbuild-upstream-twin I2/I6 invoke installed esbuild/Vite through npx. Shell
currently rejects npx even when direct bin execution succeeds. Native npx and
Chromium Acorn CLI carriers distinguish lookup from a missing/broken bin.

## Decision

- `npx <unversioned bare-bin> [args]` searches current/ancestor node_modules/.bin
  through CommandResolver's existing filesystem authority; registered shell
  builtins are not package executables. No package/version allowlist.
- Accept leading `--no-install` and `--`; forward subsequent arguments,
  command context, output, cancellation and exit through the existing BinExecutor.
  Apply the host's command policy to the selected command too.
- No second spawn, shell-string reconstruction, cache or registry client.
- Missing local bins, package specs, other leading options and interactive
  mode throw named `shell.npx.acquire`, `.package-spec`, `.options`, `.interactive`
  gaps. These remain explicit limits, not implicit installs or npm nudges.
- Other package-manager nudges remain their existing separate backlog scope.

## Proof

`local-npx.spec.ts`: real upstream Acorn tarball, native npx oracle, direct-bin
preflight, cwd walk-up, quoted filename/flags and unchanged registry request
count. `npx-refusals.test.ts`: real empty VFS, including a registered shell
builtin which must not impersonate an installed package.
