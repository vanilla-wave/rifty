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

## Q-2026-05-25-touch-utimes: Where should `utimes` live on the sync VFS surface?

**Status:** 🟢 Active
**Encountered in:** PR fixing 1.6 (shell silent stubs) of `docs/review/2026-05-25-stubs-and-adr-violations.md`
**Milestone:** M10
**Author (agent session):** 2026-05-25

### Context

`packages/shell/src/builtins.ts` `touch` needs to update mtime on an existing
file. The `FsSync` interface (`packages/vfs/src/fs-sync.ts`) does not expose
`utimes`/`setMtime`. Reaching backend mtime mutability touches the VFS public
API — adding a new method on `FsSync` is irreversible per the checklist (point
1). For now we backend-sniff: if `syncMirror()` is a `MemoryFsSync` we mutate
`backend.<node>.mtime` directly; otherwise we throw `NotImplementedError`. The
in-memory case is the only one that runs in the current playground / tests, so
the throw path has no live callers — but as soon as OPFS becomes the default
sync mirror, `touch` on an existing file fails loudly until this is wired
through `FsSync.utimes`.

### Options considered

- **Option A:** Add `utimes(path, atime, mtime)` to the `FsSync` interface.
  `MemoryFsSync` implements via direct backend mutation; `OpfsFsSync` uses the
  closest analogue (recreating the file is not free, but mtime-only update is
  not supported by `FileSystemSyncAccessHandle` — would need a metadata
  side-table on top).
  - Pro: clean interface, no backend sniffing in higher layers.
  - Con: irreversible (public API of `vfs` package, touches every `FsSync`
    backend including OPFS which has no native utimes).
- **Option B:** Keep backend-sniffing in shell (current code). `touch` is the
  only consumer; if a second consumer appears (`node:fs.utimesSync` from
  `runtime-js/builtins/fs.ts`) escalate to Option A.
  - Pro: zero VFS API changes; throws loudly for unsupported backends.
  - Con: leaks "I know my backend is `MemoryFsSync`" into a higher layer.

### Decision taken (provisional)

**Chose:** B

**Why:** `touch` is the only caller today; Option A demands a real OPFS-side
strategy for mtime that isn't free, and the shell already lives in a higher
layer that's allowed to know about installed backends. Promote to A when a
second caller appears.

### Code markers

- `packages/shell/src/builtins.ts` — `bumpMtime()` with the `TODO(ADR)` marker
- `packages/shell/src/builtins.ts` — `touch` calls `bumpMtime`

### Reversibility justification

- Public APIs affected: none. Internal to `packages/shell/`.
- Cost to revert: <30 lines, 1 file.
- External dependencies: none.

### Needs human review by

End of milestone M10.



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

---

## Rejected

- **Q-2026-05-23-006** — *`node:https` aliased to `node:http`* — **rejected** in favour of a loud `NotImplementedError`-throwing stub (ADR 0010). Silent stub violated the "no silent stubs" hard rule. Vite's defensive top-level import still works because import-time doesn't trigger the throw.
