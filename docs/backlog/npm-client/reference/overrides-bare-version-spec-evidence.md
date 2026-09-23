# Overrides bare version — observed defect and RED

Reference: npm 11.17.0 on Node 24.16.0, `npm install --package-lock-only
--ignore-scripts` with vitest 4.1.11 and `overrides: {vite: "8.0.16"}`
records one `node_modules/vite@8.0.16` satisfying vitest's Vite edge.
Command, lockfile query, and output:
`docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md` §Oracle.

Rifty browser baseline on main `51440931a`: the same manifest reports
`npm: install failed: Failed to fetch packument 8.0.16: 404`.
The `vite@8.0.16` spelling installs 48 packages and one root Vite 8.0.16.
Command and output: the same goal evidence §I1.

RED on `0c4c1b070` + the test-only diff, 2026-09-23:

```sh
/Users/vanilla-wave/.t3/worktrees/rifty/t3code-8f2c054b/node_modules/.bin/vitest run packages/npm-client/src/installer.test.ts -t 'pins a transitive vite edge'
```

```text
Test Files  1 failed (1)
Tests       1 failed | 1 passed | 49 skipped (51)
pins a transitive vite edge with override 8.0.16
  → fake registry: no packument for 8.0.16
```

The passing parameter is the existing `vite@8.0.16` spelling. Registry
substitution is only the network boundary; the real installer, VFS, resolver,
linker, and lock writer run in the test.
