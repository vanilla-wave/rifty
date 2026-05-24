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

*No active questions.*

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
