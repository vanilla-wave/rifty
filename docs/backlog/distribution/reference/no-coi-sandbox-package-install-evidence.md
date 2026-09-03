# No-COI sandbox package-install evidence

Captured 2026-09-03 from `9566f4caf`. Node `v24.16.0`, Playwright `1.60.0`,
Chromium `148.0.7778.96`. Existing certified carriers only; product/tests
unchanged.

## Public install

```sh
pnpm test:no-coi -g \
  'build parity: headerless SDK dist equals live COI product bytes' \
  --reporter=dot
# Running 1 test; 1 passed (1.6m)
```

The selected public test installs the frozen Vite `7.3.6` dependency digest in
the headerless SDK Worker, reads every exact direct package version, and reads
the exact `esbuild-wasm@0.28.0` registry-twin trace, lock entries, byte length
and SHA-256 before the downstream build assertions. Its COI sibling reads the
same direct versions from the same digest.

## npm faults

```sh
pnpm exec vitest run \
  packages/npm-client/src/registry.fault.test.ts \
  packages/npm-client/src/installer-concurrency.test.ts \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts \
  -t 'headers stall|packument body stall|tarball body stall|runaway body|collapses concurrent same-\(name,version\) fetches|a failed REQUIRED dep fetch|promotes a deferred optional-descendant fetch|rejects .* projection drift before tarball or VFS work|forwards abort to a reached twin tarball stall|keeps wrong-integrity bytes unpublished' \
  --reporter=dot
# 3 files passed; 13 tests passed, 43 skipped (19.19s)
```

Selected cases cover header/body progress bounds, byte cap, required fetch
failure, same-identity in-flight dedupe and required-demand promotion,
registry-twin projection drift, reached tarball abort/retry and corrupt-byte
non-publication/retry. This is inherited npm-client authority; the SDK adds no
network or concurrency mechanism.
