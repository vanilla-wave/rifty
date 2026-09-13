# Required baseline repair: npm archive roots

BASE ded600da1. Goal agent-bench Acceptance8/I8; UI declaration observation I5.
Skill route: observed defect → real npm baseline → RED → shared fix → proof.

## Observed baseline

UI `/tmp/pr333-bench-baseline-ui.log`:14 real model-boundary requests; tsc reports
TS2688 for7 implicit libraries, Monaco TS7016/7026. package.json declares types,
but public owner reads node_modules/@types/react/package.json and react-dom fail.
Native `/tmp/pr333-bench-baseline-native.log`:13 requests; types present, tsc passes.
Both are fresh synthetic Trackline projects with real npm, no host mocks.

Original @types/react19.3.0 bytes from the same configured registry have `react/`
root. Native Node24.16.0/npm11.17.0/pacote21.5.1 extracts all16 files directly into
the package directory. Rifty retained `react/`, e.g. react/package.json. This is
extraction, not a TypeScript host-resolution failure. Source and complete hash
oracle: packages/npm-client/src/_test-fixtures/types-react-19.3.0/.

## Fault class and sweep

Boundary: owned in-process archive path projection. `frozen-assumption` (only a
literal package/ root), `lossy-aggregate` (ordinary __proto__ file disappears),
`corrupt-input` (strip must not admit traversal). One actual extractor caller:
installer-walk acquisition; live/lock/Eddy-fed raw tarballs converge there.
parseTarEntries/parseTarHeader additionally serve raw Eddy containers and keep
names verbatim; no npm-root stripping there. No copied linker workaround.

At this synchronous projection, transport loss/duplicates/reorder, concurrent
writers, quota failure and partial VFS commit are physically absent; bytes are
already acquired/integrity-checked and the output map is local. Existing acquisition
and link failure gates remain. Materialized tree caches are a reachable downstream
`poisoned-cache`: old layout must lose install authority; existing identity owns it.
Raw compressed tarball cache remains byte/integrity-valid. ADR-0435 adds layout to
ADR-0261 identity; snapshots are rebuilt by producer, never relabeled.

## Proof

- Native original archive → exact paths/sizes/SHA256 of16 files.
- Native valid synthetic corpus: named/dot/multiple roots, flat member,
  ordinary __proto__/constructor. Each includes a valid root package.json.
- `/tmp/pr333-types-unpack-red.log`: original archive RED, react/* vs native paths.
- `/tmp/pr333-types-unpack-class-red.log`: class corpus RED.
- `/tmp/pr333-types-install-identity-red.log`:6PASS/1RED; old materialized key unchanged.
- `/tmp/pr333-types-unpack-green.log`:18PASS (original bytes, variants, traversal, identity).
- Revert-checks `/tmp/pr333-types-mutant-{package-prefix,plain-object,outer-traversal,old-install-key}.log`: all4 rejected.

Integration: fresh +chat and packed no-COI both now read the actual declarations
and pass .bin/tsc --noEmit; +chat diagnostics(src/App.tsx) returns[]. Raw baseline
reports/traces and results table are in agent-bench-baseline-results.md.
Producer re-bake completed with current identity; snapshot artifact check PASS.
108 owner/cache/Eddy/unpacker tests PASS; final full PR gate follows.

Class sweep also found NUL regular-file typeflags treated as unknown: String.fromCharCode(0)
is NUL, not an empty string. Native npm accepts the same valid archive; the added
corpus row RED reproduced empty output, then GREEN restores both files. No new API.

NUL regular-file guard revert-check: /tmp/pr333-nul-type-mutant.log rejected it.
The raw tar parser continues to serve Eddy containers, with existing Eddy suites green.
