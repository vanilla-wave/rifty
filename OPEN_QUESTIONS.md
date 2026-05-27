# Open Questions

Living buffer for provisional design decisions made by AI agents during work, awaiting human review. See D-007 in `PROJECT_PLAN.md`.

## How to use

When you encounter a **reversible** design choice during implementation:

1. Make a provisional decision
2. Add an entry below using the template
3. Mark the code with `// TODO(ADR): Q-YYYY-MM-DD-NNN`
4. Continue working — do not stop

When a question is reviewed:
- **Confirmed:** promote to ADR via `pnpm adr:promote Q-...`. This removes `TODO(ADR)` markers and creates an ADR entry.
- **Rejected:** rework with a new approach; entry is moved to "Rejected" section below for historical record.
- **Deferred:** update `Needs human review by` and leave in place.

## Status

- 🟢 Active: provisional decision in code, awaiting review
- 🟡 Under review: human is currently evaluating
- ⚪ Promoted: moved to ADR (kept here briefly for traceability, then archived)
- 🔴 Rejected: see "Rejected" section

---

## Active

## Q-2026-05-27-002: Coherent `OwnerResolver` + readiness-registry swap (M11 prep)

**Status:** 🟢 Active  
**Encountered in:** 2026-05-26 architecture audit follow-up (service-worker F3), 2026-05-27 triage  
**Milestone:** M11  
**Author (agent session):** 2026-05-27

**Update (2026-05-27, post-ADR-0043):** A-026 (Vite-in-Worker) landed
without graduating this question. ADR-0011 explicitly sequences A-026
before A-023 (SW→Worker), and ADR-0043 honoured that sequencing — the
page is still the SW's counterpart and `FirstWindowOwnerResolver` is
untouched. The second consumer (`WorkerOwnerResolver` for A-023) has
not arrived yet; per the entry's "defer" decision, the binding shape
will be designed from both sides at once when the A-023 PR opens.
"Needs human review by" target shifts from *Start of M11* to *Start of
A-023 work*.

### Context

`PreviewOwnerResolver` is cleanly extracted (commit `1bc2f91`), but the
companion `ReadyClientsRegistry` (the SW-side handshake that tracks
which window clients are ready to receive preview fetches) still lives
inside `preview-bridge.ts` and assumes `event.source as Client` — i.e.
a window source. When M11's `WorkerOwnerResolver` arrives, both halves
need to evolve in lockstep: workers have different `pagehide` /
`controllerchange` lifecycles, so the readiness model can't just plug
into the existing window-only registry.

### Options considered

- **Option A — define `PreviewOwnerBinding` now, ahead of the second
  consumer.** Spec a shared interface for `{ resolveOwner,
  subscribeReadiness }` and refactor the window path to use it
  immediately.
  - Pro: One refactor for the eventual swap; the M11 implementation
    just adds a new binding.
  - Con: Designing from a single consumer's shape risks baking in
    window-only assumptions that the worker case will resist; net
    rework two PRs down the line is likely.
- **Option B — defer the design until `WorkerOwnerResolver` is on
  deck.** Keep `ReadyClientsRegistry` window-only for now; when the
  worker path arrives, extract `PreviewOwnerBinding` then.
  - Pro: Two concrete consumers shape the interface from real signals.
  - Con: Two-PR refactor instead of one; readability lag in the
    interim.

### Decision taken (provisional)

**Chose:** B — defer.

**Why:** Same trap that derailed early generic interfaces in this
codebase — extracting a binding shape from one consumer almost always
needs revision when the second arrives. The cost of carrying
`ReadyClientsRegistry` as window-specific for one more milestone is one
extra file rename when the worker path lands; cheap.

### Code markers

None yet — by intent. The decision is "do nothing now". When the M11
`WorkerOwnerResolver` PR is opened, this question gets promoted and the
binding interface is designed from both sides at once.

### Reversibility justification

- Public APIs affected: none — internal SW state.
- Rough cost to revert: zero (the decision is "no code change").
- External dependencies involved: none.

### Needs human review by

Start of M11.

---

## Q-2026-05-27-003: WASI preopens — explicit `cwd` and ordering semantics

**Status:** 🟢 Active  
**Encountered in:** 2026-05-26 architecture audit follow-up (runtime-wasi F5), 2026-05-27 triage  
**Milestone:** M8  
**Author (agent session):** 2026-05-27

### Context

`packages/runtime-wasi/src/wasi.ts:46-56` walks `Object.keys(preopens)`
in insertion order to allocate fd 3, 4, … . The "first preopen wins
fd 3" semantic leaks into how callers must construct the map. There is
no explicit `cwd` option, and guests like esbuild expect a working
directory (e.g. `.` or `/workspace`) — today they get whichever preopen
happened to be first in object-property order.

### Options considered

- **Option A — `cwd?: string` option.** Add `cwd` to `WasiInit` /
  `runWasi` options; semantics: this preopen is the relative-path
  resolution default; insertion order otherwise.
  - Pro: Minimal API change; backward-compatible if `cwd` is omitted.
  - Con: Still depends on object insertion order for non-cwd fds; the
    test fixtures that build preopens have to remember the implicit
    rule.
- **Option B — ordered array `[{ guestPath, hostPath }]`.** Replace
  the `Record<string, string>` shape with an array; first entry is
  fd 3, `cwd` is documented as the first entry.
  - Pro: Order is explicit; no hidden semantics tied to object key
    iteration.
  - Con: Breaks every existing caller; needs migration.
- **Option C — both: `{ preopens: ordered array, cwd: explicit }`.**
  Decouple "what to mount" from "what's the relative-path default".
  - Pro: Fully explicit; future-proof for cases where `cwd` is a
    subdirectory of a preopen (which Option B can't express).
  - Con: Two concepts to keep in mind at call sites.

### Decision taken (provisional)

**Chose:** Defer until M8 esbuild.wasm vendoring forces the issue.

**Why:** The right API shape is best chosen from a real consumer's
constraints. esbuild's documented behaviour around its working
directory will pin down whether Option A's "first preopen" trick is
sufficient or Option C's explicit `cwd` is needed. Spending design
budget now without that constraint risks shipping the wrong shape.

### Code markers

- `packages/runtime-wasi/src/wasi.ts:46-56` — preopen iteration loop.

### Reversibility justification

- Public APIs affected: `WasiInit` / `runWasi` options shape. Once a
  caller (esbuild) is on the new shape, reversing means migrating that
  caller back — cost grows with adoption. Doing it once, at M8, before
  the first real guest is on it, is cheap.
- Rough cost to revert (if done before M8): two-line edit in
  `wasi.ts`; no callers committed yet.
- External dependencies involved: none.

### Forcing consumer update (2026-05-27, post-ADR-0044)

esbuild was the originally-anticipated forcing consumer for this question. Discovered that all published esbuild-wasm builds (0.21.5 / 0.25.0 / 0.28.0) ship Go's `gojs` ABI, not `wasi_snapshot_preview1` — esbuild has no upstream WASI build (ADR-0044). swc takes esbuild's place as the M8/M10 transformer and as the forcing consumer for this question; the deferred decision (A/B/C from above) still waits until swc.wasm actually runs through `runWasi` and exercises preopens.

### Needs human review by

Start of M8 swc.wasm vendoring work (per ADR-0044).

---

## Q-2026-05-27-001: `process.versions.node = '22.0.0'` vs ADR-0026 honesty

**Status:** 🟢 Active  
**Encountered in:** 2026-05-26 architecture audit follow-up (runtime-js P1-4), while landing audit cleanups  
**Milestone:** M10  
**Author (agent session):** 2026-05-27

### Context

ADR-0026 ratified `process.platform = 'rifty'` and `process.arch = 'wasm'`
as the honest values — they are the de-facto rifty ABI and per-package
shims are accepted as the migration cost. The same `RiftyProcess` class
nevertheless reports `version = 'v22.0.0'` and `versions = { node:
'22.0.0', v8: '12.0.0', rifty: '0.0.0' }`. This is plausibly intentional
(many ecosystem packages branch on `process.versions.node` to enable
Node-specific code paths), but it directly contradicts the ADR-0026
honesty principle. The audit flagged the inconsistency as P1-4 with no
TODO marker or open question on file.

### Options considered

- **Option A — Keep impersonation, amend ADR-0026 to carve out
  `versions.node`.**
  - Pro: Zero compat breakage. Existing packages that gate on
    `process.versions.node >= '14'` keep working.
  - Con: Splits the honesty principle into "platform/arch honest, version
    lies"; future ADR readers must hold both rules in mind.
- **Option B — Honest values everywhere.** Drop `versions.node`, expose
  `versions.rifty = '0.0.0'`, shim per-package as needed.
  - Pro: One consistent rule. Easy to explain.
  - Con: Doubles the per-package shim cost ADR-0026 already accepted,
    measured against the ~10-package budget that triggers a re-think.
    Many packages will silently take the "no Node" branch and exhibit
    confusing behaviour rather than failing loudly.
- **Option C — Keep impersonation, add a runtime warning when accessed
  via `process.version` direct (not `process.versions.node`).**
  - Pro: Surfaces the lie in noisy environments (REPL, tests) while
    keeping the compat shape for programmatic consumers.
  - Con: Noisy in legitimate paths (many packages read both). The
    warning channel risks crying wolf.

### Decision taken (provisional)

**Chose:** A — keep the current impersonation.

**Why:** Same trade-off ADR-0026 accepted for compat values; reverting
would amplify the shim cost beyond the ~10-package budget the ADR set,
and packages that branch on `versions.node` would mis-detect the runtime
without obvious failure. The honest carve-out belongs in an ADR
amendment rather than silent code drift.

### Code markers

- `packages/runtime-js/src/builtins/process.ts:90` (`version`)
- `packages/runtime-js/src/builtins/process.ts:91` (`versions`)

### Reversibility justification

- Public APIs affected: `process.version` / `process.versions` shape,
  which is read-only and already public — but the proposed reversal is a
  value change, not a structural one, so reverts are a two-line edit.
- Rough cost to revert: 2 lines, 1 file.
- External dependencies involved: None.

### Needs human review by

End of milestone M11.

---

## Template

```markdown
## Q-YYYY-MM-DD-NNN: <Short title>

**Status:** 🟢 Active  
**Encountered in:** PR #X, while implementing <feature>  
**Milestone:** M<N>  
**Author (agent session):** <date or session marker>

### Context

<2-4 sentences about what came up and why it's unclear>

### Options considered

- **Option A:** <description>
  - Pro: ...
  - Con: ...
- **Option B:** <description>
  - Pro: ...
  - Con: ...

### Decision taken (provisional)

**Chose:** <A or B>

**Why:** <1-2 sentences>

### Code markers

- `src/path/to/file.ts:42`
- `src/another/file.ts:117`

### Reversibility justification

<Why is this reversible? Answer:
- What public APIs are affected? (should be none)
- What's the rough cost to revert? (should be <100 lines / <2 files)
- Are any external dependencies involved? (should be no)>

### Needs human review by

End of milestone M<N>.
```

---

## Promoted

- **Q-2026-05-23-001** — *Identifier rewriter strategy for ESM live bindings* —
  promoted to **ADR 0009** (`docs/adr/0009-ast-based-esm-transform.md`). The
  provisional regex/zone-scanner approach was replaced with an AST-based
  rewriter using `acorn` + scope tracking after the regex approach broke for
  real Vite's pre-bundled deps (parameter-shadowing of an imported name).
- **Q-2026-05-23-002** — *Realm where toolchain dev-servers run* — promoted to **ADR 0025** (`docs/adr/0025-toolchain-dev-server-realm.md`). Main-thread realm ratified for M10 Dev Mode and Real Vite; a future Worker + cross-realm bridge remains the right long-term answer (M10 follow-up).
- **Q-2026-05-23-003** — *`process.platform` / `process.arch` honest values vs compat lies* — promoted to **ADR 0026** (`docs/adr/0026-process-platform-honest-values.md`). `'rifty'` / `'wasm'` confirmed as the de-facto public ABI; per-package shim cost accepted; revisit at ~10 shimmed packages.
- **Q-2026-05-23-004** — *File-level shim overlay vs full-package shadow* — promoted to **ADR 0027** (`docs/adr/0027-file-level-shim-overlay.md`). Per-file overlay in the consuming adapter kept until a third shim site appears, at which point the pattern moves into `@rifty/npm-client/shims/`.
- **Q-2026-05-23-005** — *Expanded `@rifty/runtime-js` public surface via `./builtins/*` subpath exports* — promoted to **ADR 0018** (`docs/adr/0018-runtime-js-subpath-exports.md`). Retroactive accept; consolidation to a `./host` entry remains an option for the next public-API review.
- **Q-2026-05-24-007** — *Prod proxy for npm registry* — promoted to **ADR 0028** (`docs/adr/0028-prod-proxy-for-npm-registry.md`). Vercel Edge Function chosen as the prod proxy, falling back to Cloudflare Worker by config change; closes PROJECT_PLAN.md Q4'.
- **Q-2026-05-25-touch-utimes** — *Where should `utimes` live on the sync VFS surface?* — promoted to **ADR 0029** (`docs/adr/0029-utimes-on-fs-sync.md`). The trigger condition fired: a second caller (`node:fs.utimesSync` in `runtime-js`) appeared, so the provisional Option B (backend-sniffing in `shell`) was escalated to Option A — `FsSync.utimes` lives on the interface, `MemoryFsSync` mutates the shared backend, `OpfsFsSync` records into an in-memory side-table (`FileSystemSyncAccessHandle` has no mtime mutation). `shell/src/builtins.ts` drops its `@rifty/vfs/internal` import.

---

## Rejected

- **Q-2026-05-23-006** — *`node:https` aliased to `node:http`* — **rejected** in favour of a loud `NotImplementedError`-throwing stub (ADR 0010). Silent stub violated the "no silent stubs" hard rule. Vite's defensive top-level import still works because import-time doesn't trigger the throw.
