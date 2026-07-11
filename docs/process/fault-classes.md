# Fault classes — one taxonomy for infra honesty

One vocabulary across the pipeline: refine (`## Fault matrix` in items) → implementation (fault tests) → review (every correctness blocker classified) → fixing (`rifty-fix` skill). Mined from PR #107: 19 review rounds, ~50 findings — almost every round after R5 found a new INSTANCE of an axis already seen, hence §Class-kill.

## Axes

Apply at any boundary — network, storage/OPFS, cache, worker/process, concurrency:

| Axis | Fault | Canonical #107 case |
|---|---|---|
| `unbounded-read` | stream/body/loop without progress bound + byte cap | `response.json()` on a hung proxy parked install past every stall timeout |
| `torn-state` | failure between steps of a multi-step write; partial state trusted later | lockfile on disk before link+shims; stamp trusted over torn `node_modules` |
| `corrupt-input` | truncated / malformed / duplicate / extra member at an untrusted boundary | dup tarball member: integrity checked the LAST member, streaming client read the FIRST |
| `poisoned-cache` | changed bytes under a stable/immutable key; body-dependent response cached by URL | recompute re-put fresh `resolvedAt` bytes under a one-year-immutable GET URL |
| `provenance-lie` | success/source claimed without proof | S3 put unverified (private bucket linked a 403 hash); `source:'eddy'` while replay silently hit the registry |
| `false-fallback` | optional path failure breaks the flow instead of degrading to default | transient `store.get` throw treated as fatal instead of miss→recompute |
| `concurrent-same-key` | racing writers on one key observed by a reader | two dep-sets → same closure: 2nd PUT races 1st reader |
| `quota-perm-fail` | storage quota/permission failure mid-op swallowed | per-op OPFS persist fail eaten → tree looks durable, torn on reload |
| `observable-order` | validation/check runs before the required protocol/syscall step, hiding its side effects or error priority | PR #115: `readFileSync({ flag:'wx' })` returned `EBADF/read` before open could report `EEXIST/open`; `writeFileSync({ flag:'r' })` skipped `ENOENT/open`; gap-throws (NotImplementedError) before Node-visible errors are the same axis — a gap replaces Node's SUCCESS path, never its error path |
| `sibling-drift` | one semantic implemented twice (sync/async twin, second backend, bespoke shape) drifts apart | PR #115: `OpfsVfs.mkdir` let an existing dir pass while Memory/OpfsFsSync threw EEXIST; watchFile's bespoke `StatsLike` vs the real `Stats`; `statSync` silently ignored `bigint` while `promises.stat` threw. Kill = shared contract suite (`describe.each` over backends) / one shaping chokepoint |
| `frozen-assumption` | unverified external behavior pinned by a self-referential test (conformance snapshot with no oracle) | PR #115: write-stream destroy 'error' sequence born wrong inside a green rifty-vs-rifty conformance test (`29828aff`); `cat -A` goldens froze raw high bytes GNU renders as `M-x`. Kill = parity case / real-tool golden, not a rewritten assert |
| `lossy-aggregate` | an identity/gate/ratchet compares a lossy projection (flattened map, count, truncated sample) of the real input — distinct inputs collide | PR #113 count-ratchet (same-count swap invisible); ADR-0216 r5: the stamp unmoved-guard compared the flattened dep map — a dependencies↔devDependencies move or `overrides` edit changed the installer request with an identical flat map. Kill = compare the exact input (bytes/text/digest), never its aggregate |

## Honest-outcome contract

Every (axis × operation) resolves to exactly one of: **transparent success via fallback** · **degraded-but-correct, visibly** · **loud throw**. Always forbidden: the silent lie — wrong bytes, false provenance, a hang, trusting torn state.

## Fault tier

A fault test injects one axis at one boundary and asserts the honest outcome. Convention: `*.fault.test.ts` (or a fault-labelled case in the owning suite). Injection is per-boundary — small decorators (fetch stall/500/truncate, VFS fail-persist predicate, store byte-corruptor), deliberately NOT one framework. Tooling + migration of existing de-facto fault tests: `docs/backlog/process-meta/fault-tier.md`. Pyramid slot: `docs/process/testing.md`.

## Class-kill

Second instance of an axis at the same boundary = structural fix — one chokepoint API / one validation boundary / a gate — never another point fix. Precedent: `unbounded-read` survived #107 R5→R17 as four sibling point-fix helpers until `drainBodyBounded` consolidated the class. New axis found in review → add its row here first, then fix.

Design-stop trigger: **more than TWO coordination mechanisms guarding one file/key** (locks, generations, chains, rechecks, proof ladders…) = the invariant has no owner — STOP adding mechanism #3, consolidate into one authority (single serialized writer). Precedent: PR #131 install stamp grew 7 mechanisms across 5 review rounds before the authority was named (ADR-0216 §audit); the trigger would have fired at round 2. A growing fix-surface across review rounds (each round's fixes feed the next round's findings) is the same signal at process level — §Review convergence row "Repeat" owns it.

## Review convergence

Applies to parity work and changes touching cache, persistence, network, or concurrency.

| Gate | Required evidence |
|---|---|
| Contract | Pinned oracle; acceptance/parity cases; observable identity, lifecycle, error order; loud gaps |
| Review | Each correctness blocker: fault class + RED test + sibling sweep in the PR |
| Repeat | Same class at one boundary, or a review change adding a state owner → redesign/split |
| External API | Proxy/wrapper semantic copy requires an ADR + differential suite |
| Testing | Same scenario runs against reference and rifty; a fake cannot close acceptance |
| CI | Required finite checks pass on one committed SHA |
| Closure | Observable acceptance proof; never source grep, warning, or opt-in lane |

1. Before implementation, freeze the oracle, acceptance/parity cases, and loud gaps.
2. Record class, RED test, and sibling sweep directly in the PR; no separate ledger file.
3. A repeated class or review-born state owner stops point fixes: redesign or split.
4. Use two review checkpoints only: Contract+RED, then Final+GREEN.
5. Final requires full checks on one SHA and zero blockers; outcome is merge or redesign, never another point-fix round.
