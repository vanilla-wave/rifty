# PR359 — OPFS overhead population accounting

Observed baseline: `550538dd714d2acdf217412a52d4ae00c3e84c9e`, CI36365591064
attempts1/2. Both:274 browser PASS,1 skipped; only pending-write overhead guard
failed (`opfs-parallel-drain.spec.ts:191`). No third retry. VFS/worker/spec unchanged
from main99fdf6c91. Agent goal I1–I13 remains independently proven at136c94ade.

| Observation | Serial ms | Product ms | Speedup | Old write estimate ms | Write population ms | Mkdir population ms | Sum /10% bound ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| CI attempt1 |75646|24044|3.14609|13937.69835|6968.84917|292.91017|7261.75935 /7564.6|
| CI attempt2 |94134|28826|3.26555|13078.40580|6539.20290|149.47132|6688.67422 /9413.4|
| Isolated macOS |40312|13095|3.07844|0|0|30.16238|30.16238 /4031.2|

Every run:26,811 files,2,314 dirs,166,782,155 bytes; both complete trees and
ledgers verified. Original records: `/private/tmp/rifty-pr359-final-ci-failed-output.log`,
`/private/tmp/rifty-pr359-final-ci-retry-failure.log`,
`/private/tmp/rifty-pr359-ci-opfs-isolated.log`; public CI run36365591064.

## Root and scope

The faithful loop performs one write-flush and one mkdir-flush per file. The
write delta was multiplied by **all**53,622 flushes, although mkdir has its own
measured delta. Its two independent10% bounds also admit a combined over-budget
population: write4% +mkdir7% passes both old bounds (8% and7%), despite11% total.
Fault boundary: measured shape→population projection; `frozen-assumption` (one
shape's cost assigned to another) and `lossy-aggregate` (independent bounds hide
combined cost). Sweep: write and mkdir share one weighted sum; empty-call bound,
raw ratio≥2.5×1.05, exact counts/trees/ledgers stay unchanged. No product change.

Correction: positive write delta×(all−mkdir count) + positive mkdir delta×mkdir
count ≤ existing10% serial duration. Faster shapes never credit another shape.
This is a contract-stable count correction, not a new latency target or runtime
mechanism. Independent PR-4 review must compare old/new criteria before landing.
Existing `perf/opfs-parallel-drain-load-sensitive-threshold` still owns general
sampling noise; this repair does not claim to eliminate all wall-clock variance.

Rejected hypothesis: native I/O parallelism in this probe. Actual64-write
Chromium148 experiment (real bytes, with/without10ms native createWritable delay)
measured peak1 in both shapes: current scheduler's same-directory sibling link
serializes them. No speculative runtime repair. Script/output retained at
`/private/tmp/rifty-pr359-opfs-probe` and `rifty-pr359-opfs-native-probe.log`.

Independent Linux baseline: Playwright1.60.0 Docker jammy arm64, Node24.15.0,
Chromium148.0.7778.0; original worker over read-only source. Serial87233ms,
product22944ms,3.80195×, both full trees clean. It did not reproduce the timing
failure. Log `/private/tmp/rifty-pr359-opfs-linux-baseline.log`.

## RED

Extracted old two-bound predicate unchanged as max(write delta×all calls,
mkdir delta×mkdir calls). `tools/checks/opfs-drain-overhead.test.ts`:4 RED/3 PASS
before repair; exact two CI records, combined-cost counterexample and no negative
credit. Write-only/mkdir-only/common-overhead violations already reject.
`/private/tmp/rifty-pr359-opfs-overhead-red.log`. No mocked rifty package or
relabelled benchmark outcomes; frozen recorded measurements supply regression data.

## GREEN and reversion

Weighted sum:7/7 regression tests PASS; restoring the old helper produces the
same4 RED/3 PASS, restoring the fix returns7/7. Logs
`/private/tmp/rifty-pr359-opfs-overhead-{green,revert,final-green}.log`.
Actual unchanged acceptance spec in Linux Chromium148:1/1 PASS (2.4m),
serial88252ms/product22170ms,3.98061×; all26,811 files/2,314 dirs byte-exact,
clean ledgers. Original2.5×1.05/10% bounds retained. Docker Playwright1.60.0
jammy arm64, read-only checkout; actual test runner, not a copied predicate.
`/private/tmp/rifty-pr359-opfs-linux-green.log`. No concurrent build or test load.
