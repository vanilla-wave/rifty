# PR357 — final CI repairs

Whole-goal review accepted implementation2534d1e97; subsequent CI run
36756587516 exposed three additional failures. CLOSE is finalized only after
these repairs and renewed independent Final+GREEN. Original accepted user
scope/decisions unchanged.

## Baselines and causes

| Boundary / class | Observed RED | Repair / retained authority |
| --- | --- | --- |
| Extracted helper caller, sibling-drift | no-coi job110028470758: surface-only called browserRegistryPackages without repoRoot; resolve(undefined) | Pass repoRoot as in full-consumer caller; same original genuine archive assertions. OS-independent; exact surface/budget lane required. |
| npm-save oracle, frozen-assumption | light5 job110028471531 and local owner-snapshot-restore-exec RED: old latest vs actual ^1.6.0 | ADR-0487 already requires native save for COI too. Assert ^actual installed version before teardown, exact same range after switch/reload/fast reload; original file/executable checks retained. |
| HTTP registry input, frozen-assumption | browser job110028470833: frozen source-map-js1.2.1 vs live1.2.2 | Serve full frozen Sass dependency closure at HTTP boundary from existing genuine archives. Verify original bytes/SHA256/SHA512/manifest; retain exact lock/provenance/build/HMR/offline assertions and original abort. No golden/resolver change. |
| Deferred acquisition promise, observable-order | isolated unchanged Sass abort killed Worker; actual install probe: unhandled1 then same owned error, both onPackage branches | Observe final canonical acquirePin promise immediately; retain original promise for allSettled and required failure. No lock published, no successful Sass callback. |

Promise root: acquisition begins before descendant metadata resolves; the final
allSettled used to attach the first rejection handler too late. Sweep:
installer-walk acquirePin is the single required/optional/replay acquisition
owner; both callback branches meet there. installer-sources prefetch and
RegistryClient tarball paths already attach immediate observers. No new queue,
transport model or error suppression: install still rejects the original error.

Fresh reviewer independently diagnosed all four causes and checked PR-4 against
the baseline before repair. Deferred failure was already present before I9;
it remains required because the retained Sass fault surfaced it during this run.

## Executed proof

- `installer-deferred-acquisition.fault.test.ts`: real install + MemoryVfs +
  RegistryClient + original Sass tarballs; only HTTP held/fails. Child process
  covers both onPackage branches. RED unhandled1 each; GREEN0, same failure,
  no lock, no failed-package callback. Removing observer kills guard; restored
  GREEN. Logs `/tmp/rifty-pr357-deferred-acquisition-{red,green,revert,final-green}.log`.
- Original Sass Chromium scenario GREEN1 after both fixes: abort/retry,
  real Vite SCSS dev/HMR/build, exact closure and offline reopen.
  `/tmp/rifty-pr357-ci-sass-green2.log`. First local RED hit the real promise
  defect before reaching registry drift; an intermediate fixture import failed
  before test loading, then fixed with native JSON import attribute.
- Owner snapshot e2e GREEN1, including trusted fast-reload branch:
  `/tmp/rifty-pr357-ci-cowsay-green.log`; unchanged baseline RED at old latest
  assertion: `/tmp/rifty-pr357-ci-cowsay-red.log`.
- The documentation-close tree530c177e7 also ran full pr:check27/27; this is
  not substituted for gates on the new implementation below.

The first repair gate stopped at a fixture-only TS target mismatch
(Promise.withResolvers is newer than the package lib). Replaced with ordinary
Promise resolver capture; no target change. Stopped that owned gate after diagnosis;
no whole-gate PASS claimed from it.
