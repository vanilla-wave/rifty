# PR #299 follow-up proof

Baseline: merged main `db50e46b24ac82a0c77514c44bf888b3c99c5c1e`.
Authority: ADR-0425 §4 HEAD-only commit and §8 honest loss notice;
ADR-0411 acquired-tree failures never select empty memory storage.

## Root causes and RED

- First commit: `writeNative` creates HEAD before opening/closing the atomic
  writable. Terminating its real Worker before open or before close leaves
  exactly 0 native bytes. Fresh Worker replay reported `corrupt: Invalid replica
  JSON` despite no committed tree. After-close control restores both complete files.
- Diagnosis: `storageLayoutSummary` let JSON, UTF-8 and schema errors escape
  untyped. `selectOwnerStorage(preferred)` treated each as unavailable OPFS and
  published a memory owner. Required controls rejected; committed marker bytes
  remain unchanged after rejection.

```sh
RIFTY_PLAYGROUND_PORT=5399 pnpm test:browser-unit tests/browser-unit/legacy-layout-notice.spec.ts tests/browser-unit/replica-persistence.spec.ts --grep 'first commit death|rejects malformed'
```

Before production edits: 5 RED / 4 controls GREEN, 10.4 s. After edits: complete
two-file suite 39/39, 53.7 s. Revert-check only HEAD guard: 2 RED / after-close
control GREEN, 4.9 s. Revert-check only typed diagnosis error: all 3 preferred
cases RED. Each mutation restored after its run.

## Fault matrix

| Boundary / axis | Trace | Carrier / outcome |
|---|---|---|
| Native first HEAD / torn-state | ADR-0425 §4 | `replica-persistence.spec.ts`: death before writable open, before close, after close; empty uncommitted tree or complete committed tree, no false diagnosis |
| Acquired marker / corrupt-input, false-fallback | ADR-0411 | `legacy-layout-notice.spec.ts`: malformed JSON, schema, UTF-8 × required/preferred; reject, preserve exact marker bytes |
| Native committed state / corrupt-input | ADR-0425 §4 | Existing head/segment/truncate cases still diagnose corruption and preserve physical bytes |
| Native writer / quota-perm-fail, concurrent-same-key | ADR-0425 §6–7 | Existing quota, compaction quota, guard contention and late-settlement tests remain GREEN |
| Legacy notice / provenance-lie | ADR-0425 §8 | Browser-unit + real Playground e2e assert edited source, npm installs, cloned repositories, Git history |

Storage's full fault surface remains applicable; no fault row struck. No new
coordination or state owner. HEAD remains the single commit authority.

Sibling sweep: HEAD load has one `decodeHead` caller. Segment files are also
created before close but cannot be reached before HEAD commits their digests;
referenced empty/truncated segments remain corrupt. Native read failures already
become `OpfsPreloadError`. Workbench's native legacy detector already wraps its
non-absence errors; the persisted diagnosis has one reader. One catch now covers
read/decode/parse/schema failure at that reader. Malformed orphan project records
have ADR-0432's separate skip-and-retain behavior and do not choose a backend.

## Other authorized follow-ups

- Loss-category e2e: `RIFTY_PLAYGROUND_PORT=5399 pnpm test:e2e:light
  tests/e2e/storage-layout-notice.spec.ts --workers=1` — 1/1, 7.9 s.
- Workbench + SDK README: distinct same-origin namespaces; second replica writer
  rejects even with preferred policy (ADR-0425 §7).
- Budget rebaseline and PR-4 old/new evidence:
  `docs/backlog/toolchain-build/reference/client-bundle-budget-evidence.md`.
- Handoff process-format observation F: closed historical goal; no requested edit.

## Emitted artifact verification

Final repaired tarball graphs and new budgets pass in fresh Chromium (15 + 72
tarballs). The TypeScript-worker asset stays 10,022,694 B; only six static
chunk hashes and one lazy module-loader hash changed. Normalizing those seven
import fingerprints makes the baseline/current bytes identical. Updated exact
SHA-256 to `018ea49b3a1971609fdd02fb3f5b9db85daf0a4398fb500bbbf39bdda149b422`;
`check:esbuild-legacy-retirement` passes. Other emitted-asset criteria unchanged.

`RIFTY_PLAYGROUND_PORT=5399 pnpm test:e2e:prod`: 7/7, 3.0 min, including
owner boot, Buffer identity, Express/sqlite, Hono, Koa, TypeScript editor and
Webpack cold install/HMR/reload in emitted assets.

## Full gate

`pnpm pr:check`: 25/25, including parity. Initial test-run: 10,387 tests,
10,367 pass / 2 fail / 18 skipped; both failing files passed the gate's single
isolated rerun. Zero Vitest test timeouts. Recorded host load at rerun:
33.2 / 39.1 / 23.4 on 12 CPUs.

- `dep-snapshot-preparation.contract.test.ts`: actual compression progress guard
  fired (`no body progress for 10000ms`).
- `no-coi-project-watches.test.ts:79`: timer-driven poller notification was still
  absent at its assertion (`expected false to be true`).

Both are unchanged tests outside the repaired storage paths. Host contention
is a hypothesis, not an established cause. Neither failure reproduced in the
required isolated run; no speculative source/test change or extra retry.
