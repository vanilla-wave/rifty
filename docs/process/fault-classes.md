# Fault classes — one taxonomy for infra honesty

One vocabulary across the pipeline: refine (`## Fault matrix` in items) → implementation (fault tests) → review (class analysis at round 3+) → fixing (`rifty-fix` skill). Mined from PR #107: 19 review rounds, ~50 findings — almost every round after R5 found a new INSTANCE of an axis already seen, hence §Class-kill.

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

## Honest-outcome contract

Every (axis × operation) resolves to exactly one of: **transparent success via fallback** · **degraded-but-correct, visibly** · **loud throw**. Always forbidden: the silent lie — wrong bytes, false provenance, a hang, trusting torn state.

## Fault tier

A fault test injects one axis at one boundary and asserts the honest outcome. Convention: `*.fault.test.ts` (or a fault-labelled case in the owning suite). Injection is per-boundary — small decorators (fetch stall/500/truncate, VFS fail-persist predicate, store byte-corruptor), deliberately NOT one framework. Tooling + migration of existing de-facto fault tests: `docs/backlog/process-meta/fault-tier.md`. Pyramid slot: `docs/process/testing.md`.

## Class-kill

Second instance of an axis at the same boundary = structural fix — one chokepoint API / one validation boundary / a gate — never another point fix. Precedent: `unbounded-read` survived #107 R5→R17 as four sibling point-fix helpers until `drainBodyBounded` consolidated the class. New axis found in review → add its row here first, then fix.
