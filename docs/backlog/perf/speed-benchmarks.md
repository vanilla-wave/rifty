# Backlog — JS-runtime speed benchmarks

A **pull backlog** for actually MEASURING the perf-plan wins. The 7-wave perf work (ADR-0081…0087, audit `docs/perf/js-runtime-perf-audit-2026-06-05.md`) shipped guarded by **correctness** tests + a few deterministic **count** instruments — but there is **no standing speed benchmark**, and several headline claims were never wall-clock measured. Seeded by the 2026-06-07 independent review.

- **IDs:** `PB-n`. **Status:** `done` · `accepted` (agreed, not built) · `idea` · `deferred` · `blocked`. **Size:** S/M/L.
- The audit **§6 "How to measure"** already has per-finding recipes — this backlog turns them into runnable benches.

## Why this exists (the gap)

The waves were protected against silent revert by **count-based RED-on-revert guards** (commit `e529766`: codec-construction count, EE `slice` count, OPFS `slice===1`, npm in-flight `>1`) — deterministic, CI-safe, but they assert *shape*, not *time*. Two consequences:

- **No regression floor on speed.** A future change can keep all counts green yet regress wall-clock (e.g. re-introduce a hidden allocation the count doesn't see, or a layout that defeats a cache). Nothing catches it.
- **Headline magnitudes are unproven.** Some are *unverifiable today*:
  - **npm #24 concurrency** — the audit's #1 cold-install lever, but the ceiling is capped by `extractTarGz` gzip-inflate/tar-parse serializing on the main thread, and the assumed registry proxy (ADR-0028 Edge Function) is **not deployed** → prod magnitude unknown.
  - **dispatcher `waitAsync` (ADR-0084 #17)** — claimed to remove the ~2–4 ms browser nested-timer clamp per parent-delegated sync call; never wall-clock measured end-to-end in a real COI Worker.
  - **resolver caching (#4/#5/#15)** — claimed ≈50% fewer source reads + parse-once-per-package; only asserted indirectly.
  - **`clearImmediate` O(1) (#28)** — micro-benched ONCE in review (2.7× @N=10 … 37.8× @N=1000) but no committed bench.

## Items

### Top ROI — cheap, deterministic, CI-safe
- **PB-1 — bench harness scaffold.** `accepted · S-M`. Pick tooling (vitest `bench` vs zero-dep `tinybench`-style runner) and a `pnpm bench` script. Decide the CI policy up front (see PB-6): **count/instrument benches gate; wall-clock benches are diagnostic, not gating** (perf is noisy on shared CI — same reasoning as the `CI=1` e2e flake note). Commit a `bench/baselines.json`.
- **PB-2 — `require('express')` / opencode-fixture cold-boot instrument (macro, count-based).** `accepted · M`. Per audit §6 (#1,#4,#5,#9): spy `vfs.readFileBytesSync` + count `findPackageScope` walks, `JSON.parse(package.json)` calls, and `TextEncoder/Decoder` constructions across one boot. Assert: each module's scope `package.json` parses once; a second sibling import does NOT re-parse; codec constructions stay at the 2 singletons; after `loader.invalidate()` the package.json IS re-read. **Deterministic → CI-gating.** Directly proves the resolver + codec wins; extends the `e529766` guards from unit-scope to a real dependency graph.
- **PB-3 — hot-primitive micro-benches (wall-clock, baselined).** `idea · M`. The primitives whose magnitude the audit already pinned: `Buffer.from`/`toString('utf8')` (1M iters, codec singletons), cached vs fresh `DataView` read (audit recorded ~48 ms vs ~2200 ms/50M), `EventEmitter.emit` single-listener, `clearImmediate` O(1) vs old O(n) splice (formalize the review's 2.7–37.8× numbers), `nextTick` burst drain (O(n) vs old O(n²)), `normalizePath` already-normalized fast-path. Diagnostic; commit baselines, compare locally.

### High — the genuinely-unmeasured latency/throughput claims
- **PB-4 — dispatcher `waitAsync` wall-clock in a real COI Worker.** `idea · M`. Per audit §6 (#8): drive N (≈5000) serialized execSync-style round-trips through `pumpOnce` (already public for deterministic driving) and assert the ~2–4 ms/call nested-timer clamp floor is gone vs the legacy `setInterval(1ms)` path. **Overlaps `BT-5`** in the browser-coverage backlog — share the `#test=execsync` harness. The single highest-value claim with zero current measurement (Node unit only has the huge-backstop stand-in).
- **PB-5 — npm install concurrency, real registry.** `blocked · L`. The in-flight gauge (`peakInFlight > 1`) already exists in `installer-concurrency.test.ts` (mechanism proven). MISSING: wall-clock against the **real** registry path (not `FakeRegistry`) + quantify how much main-thread `extractTarGz` inflate caps the overlap. Headline magnitude **blocked on the ADR-0028 Edge Function deploying** — size conservatively until then; until it lands, the honest claim is "fetches overlap" not a speedup number.

### Policy
- **PB-6 — bench CI-gating policy (provisional decision).** `accepted · S`. Which benches gate vs diagnose. Proposed: **count/instrument benches (PB-2) gate CI** (deterministic); **wall-clock benches (PB-3/PB-4) are local/diagnostic** with a committed `baselines.json` compared by hand, NOT a CI threshold (avoids flake-driven reverts). If adopted, record as an `OPEN_QUESTIONS.md` provisional decision (cache-key/policy class) + a `TODO(ADR)` at the harness.

## Recommended first pull
**PB-1 + PB-2** (+ PB-6 once): a harness plus the deterministic express-boot instrument — CI-safe, and it converts the audit's biggest headline (codec + resolver) from "claimed" to "asserted". **PB-4** next when the COI harness (`BT-5`) is built — the one latency win nothing measures today. **PB-5** waits on ADR-0028 infra.
