# Feature 09-tool-ceiling-marker — Tool-execution ceiling marker + what is feasible vs impossible
> Part of the opencode-in-rifty facade effort. Feasibility phase P5. Staged doc — NOT a ratified ADR.

## Summary

Marks exactly where the no-tool-execution boundary sits for the opencode server facade by (a) shipping ONE working read-only tool over the VFS — a pure-JS recursive grep/read built on rifty's existing in-realm `node:fs` (`packages/runtime-js/src/builtins/fs.ts`, which runs against `syncMirror()` with zero process spawn) — and (b) producing the canonical FEASIBLE-vs-IMPOSSIBLE tool table that documents the WebContainers tool-layer-substitution model bounded by the spawn ceiling.

FEASIBLE read-only substitutes: file read (`node:fs.readFile` over VFS), VFS search (pure-JS walk+match, this feature's deliverable), directory listing, file stat, glob. FUNDAMENTALLY IMPOSSIBLE (design TO them, never around): bash/shell spawn, native git spawn (`Git.run -> ChildProcess.make('git')`), ripgrep BINARY, PTY (`#pty` native C++).

The chosen substitute deliberately uses the JS path, not ripgrep-WASM, so this feature adds no new dependency and stays trivially reversible while still concretely marking the line. opencode's own tool layer wiring is NOT modified here (that is the WebContainers tool-substitution integration, a later/separate effort); this feature establishes the rifty-side capability + the authoritative boundary doc that integration would consume. The ceiling is already half-encoded in rifty: `child_process.ts:21-22` states 'there is no shell' and `spawn('bash')` is intentionally unimplemented.

## Decisions (classified)

### Decision 1 — Which ONE tool marks the feasible side?

- **Question:** What is the ONE tool we implement to mark the feasible side of the ceiling: a pure-JS VFS grep/read, or a ripgrep-WASM binary run over `runWasi`?
- **Classification:** REVERSIBLE
- **Chosen:** PROVISIONAL — a pure-JS recursive grep/read substitute that walks the VFS via the EXISTING `node:fs` builtin (`readdirSync`/`statSync`/`readFileSync` against `syncMirror`) and matches lines with the JS RegExp engine. Zero new dependency, runs entirely in-realm, no spawn. It marks the line because it does exactly what opencode's read/grep tools do (read bytes + match) WITHOUT the process-spawn that ripgrep-the-binary needs. Lives as a small helper in `packages/runtime-js/src/utils/` or a `tools/` helper; not exported across a package public boundary.
- **Alternatives:**
  - (A) ripgrep-WASM via `runWasi`, cloning the `transformWithEsbuild` pattern in `tools/shadow-registry/src/esbuild-binding.ts`. Higher fidelity to real ripgrep flags/output and faster on large trees, BUT requires vendoring a `ripgrep.wasm` artifact + a new build-time fetch script and arguably a WASI-fs preopen of the whole VFS — that is a NEW external dependency (reversibility rule 2 => IRREVERSIBLE) and a separate ADR.
  - (B) isomorphic-git read ops (`log`/`readBlob`) as the marker tool instead of grep — also a NEW dep (IRREVERSIBLE) and broader than needed to merely mark the line.
  - (C) reuse the WASI coreutils path if one already exists in `@rifty/shell` — avoids a new dep but couples the marker to shell internals and may still need a binary.
- **Trade-offs:** Pure-JS: slower on huge trees, no real ripgrep flag parity, but zero dep, zero new files outside one helper, instantly reversible, and sufficient to PROVE the feasible side and MARK the boundary (the feature's actual intent). ripgrep-WASM: better runtime fidelity but commits the repo to a vendored binary + ADR before we even know the facade needs grep performance. For a P5 ceiling-marker the pure-JS path is the right altitude; promote to ripgrep-WASM only if/when the facade's search tool is actually exercised at scale.
- **Reversibility justification:** No public API between packages (a private helper), no new external dependency (uses the existing `node:fs` builtin + JS RegExp), no ADR contradiction, and revert is deleting one small helper + its test (<100 lines, <=2 files). First 'no' on every checklist gate => REVERSIBLE.
- **Proposed Q-id:** Q-2026-05-30-061

### Decision 2 — Does substituting ripgrep-WASM / isomorphic-git cross into IRREVERSIBLE?

- **Question:** Does substituting ripgrep-WASM (or isomorphic-git, or wa-sqlite-adjacent search) as the marker tool count as crossing into IRREVERSIBLE?
- **Classification:** IRREVERSIBLE
- **⚠️ WARNING — IRREVERSIBLE DECISION, NEEDS HUMAN RATIFICATION. Do NOT silently adopt any new dependency while implementing the marker tool.**
- **Chosen:** RECOMMENDED — awaiting ratification. Do NOT pull ripgrep-WASM or isomorphic-git for THIS feature; keep the marker pure-JS. If a future effort needs real ripgrep fidelity, that is the moment to open the ADR and vendor the binary. Recommending we explicitly defer the dep, not adopt it now.
- **Alternatives:** Adopt ripgrep-WASM now (vendor `ripgrep.wasm` + fetch script, run via `runWasi` like esbuild) to get a production-grade search substitute immediately; or adopt isomorphic-git now to also cover read-only git (`log`/`blob`) as a second feasible substitute. Both deliver more capability up front but each is a NEW external dependency.
- **Trade-offs:** Adopting now: more capable facade sooner, single ADR cycle, reuses the proven esbuild WASI plumbing. Deferring (recommended): keeps the ceiling-marker minimal and dependency-free, avoids committing to a binary the facade may never stress, and preserves the option to choose ripgrep-WASM vs isomorphic-git vs JS later when requirements are concrete.
- **Reversibility justification:** Reversibility rule 2: ANY of ripgrep-WASM / isomorphic-git / wa-sqlite is a NEW external dependency => IRREVERSIBLE by rule. Must be ratified via ADR, not invented. Flagged so the synthesizer does not silently adopt a dep while implementing the marker tool.
- **Proposed ADR title:** ADR: read-only tool substitutes for the opencode facade — JS-first, ripgrep-WASM/isomorphic-git deferred behind explicit ratification

### Decision 3 — Where does the canonical boundary table live?

- **Question:** Where does the canonical FEASIBLE-vs-IMPOSSIBLE tool boundary table live so it is authoritative and discoverable?
- **Classification:** REVERSIBLE
- **Chosen:** PROVISIONAL — `docs/compat/` (a new `opencode-tool-ceiling.md` or a row-set in the existing compat-matrix), cross-linked from `docs/opencode-rifty-feasibility-2026-05-30.md`. `compat/` is already the 'what works / what does not' source of truth per CLAUDE.md, so the spawn-ceiling tools list belongs there as ❌ entries (bash/shell/native-git/ripgrep-binary/PTY) and the read substitutes as ✅/⚠ entries.
- **Alternatives:**
  - (A) Put the table only inside the feasibility doc — discoverable but not in the compat source-of-truth and not regenerable.
  - (B) Encode each impossible tool as a `NotImplementedError` feature key registered in the compat-matrix so `pnpm compat:generate` surfaces it automatically — most rigorous, but requires the integration to actually instantiate those tool stubs, which is out of scope for the marker feature.
- **Trade-offs:** `docs/compat/`: aligns with the documented source-of-truth ordering, manually maintained until the tool layer is wired. Feasibility-doc-only: lower friction but drifts from compat. Auto-via-NotImplementedError: best long-term but presupposes the tool-layer integration exists.
- **Reversibility justification:** Documentation placement only — wording/file location, explicitly 'always reversible' per CLAUDE.md. No code, no API, no dep.
- **Proposed Q-id:** Q-2026-05-30-062

### Decision 4 — How do we PROVE the impossible side is walled off?

- **Question:** How do we PROVE the impossible side is correctly walled off rather than just asserting it in prose?
- **Classification:** REVERSIBLE
- **Chosen:** PROVISIONAL — a parity/assertion test that exercises the rifty-side ceiling already present: assert `child_process.spawn('bash', ...)` / `spawn('git', ...)` does NOT silently succeed (it surfaces the documented no-shell behavior per `child_process.ts:21`), and that the PTY path (`#pty`) throws on session create. This pins the boundary as a behavioral contract, not a comment. We do NOT vendor opencode to test its real `Git.run` here; we test rifty's spawn ceiling, which is the substrate the impossible tools would hit.
- **Alternatives:** Vendor opencode and drive its actual git/bash tool to observe the throw end-to-end — highest fidelity but requires opencode in the tree (not yet vendored) and a full harness; out of scope for the marker. Or rely on prose-only documentation — cheapest, but violates the project's 'tests encode contracts' principle and the no-silent-stub rule.
- **Trade-offs:** rifty-substrate test: cheap, in-tree today, directly pins the spawn ceiling that every impossible tool transitively depends on. opencode-end-to-end: more convincing but blocked on vendoring + harness. Prose-only: insufficient by project rules.
- **Reversibility justification:** Adding a test only; no production code, no API, no dep. Trivially reversible.
- **Proposed Q-id:** Q-2026-05-30-063

## Interface contract

```ts
// Marker tool (private helper, NOT a cross-package public export):
// packages/runtime-js/src/utils/vfs-grep.ts  (or a tools/ helper)
interface VfsGrepMatch { path: string; line: number; column: number; text: string }
interface VfsGrepOptions { cwd?: string; include?: string; maxResults?: number; ignoreCase?: boolean }
// Pure-JS, in-realm, no spawn. Walks via the existing node:fs builtin (readdirSync/statSync/readFileSync over syncMirror).
function vfsGrep(pattern: string | RegExp, root: string, opts?: VfsGrepOptions): VfsGrepMatch[]
// Read substitute is just the existing node:fs surface — no new function needed:
//   fs.readFileSync(path, 'utf8')  /  fs.promises.readFile(path)  /  fs.readdirSync / fs.statSync
// NO new builtin is registered, NO entry added to packages/runtime-js/src/builtins/index.ts,
// NO new specifier intercept in the resolver. The impossible side is asserted, not implemented:
//   child_process.spawn('bash'|'git', ...) keeps its documented no-shell behavior (child_process.ts:21-22).
//   #pty stub throws on session create (owned by feature 04). This feature adds NO new public API between packages.
```

## Affected packages & seams

**Affected packages:**
- `packages/runtime-js`
- `tools/shadow-registry`
- `docs/compat`

**Seam anchors (file:line):**
- `packages/runtime-js/src/builtins/fs.ts:13-42`
- `packages/runtime-js/src/builtins/fs.ts:65-80`
- `packages/runtime-js/src/builtins/child_process.ts:21-22`
- `packages/runtime-js/src/builtins/child_process.ts:46-50`
- `tools/shadow-registry/src/esbuild-binding.ts:39-50`
- `tools/shadow-registry/src/esbuild-binding.ts:115-155`
- `tools/shadow-registry/src/index.ts:36-39`
- `packages/runtime-js/src/builtins/index.ts:78-79`

## Dependencies

**dependsOn:**
- `01-load-opencode-into-vfs`
- `06-headless-server-boot`

**Blocker proximity:** This is THE feature that sits ON the HARD BLOCKER line and exists to mark it. It stays on the feasible side by a deliberate construction: the marker tool reads and matches bytes using rifty's in-realm `node:fs` (`syncMirror`) and the JS RegExp engine — NO process is spawned, so it never touches the spawn ceiling. The impossible tools (bash/shell spawn, native git spawn via `Git.run -> ChildProcess.make('git')`, ripgrep-the-binary, PTY) all require process-spawn or native C++ which a browser/WASI realm fundamentally cannot do; this feature documents them as ❌ and asserts the ceiling (`child_process.ts:21-22` 'there is no shell') rather than designing around it. The one tempting way to drift OVER the line is choosing ripgrep-WASM for higher fidelity — that is feasible to RUN (it's WASI, like esbuild) but it crosses the REVERSIBILITY line (new vendored dep => IRREVERSIBLE), which is why it is flagged needsHumanRatification and the pure-JS path is chosen for the marker. Net: maximally close to the blocker by design, kept on the feasible side by using read-only in-realm fs + JS matching and by refusing to spawn.

## Test strategy

Three levels, parity-first per project gold standard.

1. **PARITY:** a parity-runner case for the read substitute — `fs.readFileSync(path,'utf8')` and recursive readdir over a fixture tree, diffed against Node's own fs output (Node-compatible behavior => parity is the right tool).
2. **UNIT:** `vfsGrep` against a fixed in-memory VFS fixture asserting line/column/path of known matches, `maxResults` truncation, `ignoreCase`, and include-filter — each assertion pins a specific failure mode (off-by-one line numbers, unbounded walk, missing-file ENOENT propagation).
3. **CONTRACT/ceiling:** assert the IMPOSSIBLE side — `spawn('bash'|'git')` yields the documented no-shell outcome (does not fake-succeed) and the PTY path throws on session create; this pins the spawn ceiling as a behavioral contract rather than prose.

End-to-end against real opencode tool wiring is explicitly NOT in scope (opencode is not vendored; that belongs to the later WebContainers tool-substitution integration).

## Implementation plan (test-first)

1. **T1 — Read-substitute parity case (parity).** Add a parity-runner case proving the READ substitute is Node-compatible: recursive readdir + `fs.readFileSync('utf8')` over a fixture tree, diffed against real Node. This is the ✅ 'feasible side' read primitive that opencode's read tool would consume. Parity is the right level per CLAUDE.md gold-standard rule (Node-compatible fs behavior). NO production code in this task — the fs builtin already supports these; the case proves the substitute is exactly the existing in-realm `node:fs` surface (zero spawn).
   - **FAILING test to write first:** `tools/node-parity-runner/cases/fs/recursive-read.case.ts` — setup files `{ 'a.txt':'one', 'sub/b.txt':'two', 'sub/deep/c.txt':'three' }`; code walks via `fs.readdirSync(dir,{withFileTypes:true})` recursively, collects paths + `fs.readFileSync(p,'utf8')` contents, `console.log(JSON.stringify(sorted))`. Runner asserts rifty stdout === Node stdout. FAILS first only if the walk uses an fs API with a divergence; if it passes immediately, keep it as the regression pin for the read substitute (documented intent: lock the read primitive Node-equal).
   - **Files:** `tools/node-parity-runner/cases/fs/recursive-read.case.ts`
   - **Test kind:** parity

2. **T2 — Pure-JS VFS grep marker tool (unit).** Create the pure-JS VFS grep marker tool as a PRIVATE helper in runtime-js (no cross-package export, no new builtin, no resolver intercept). It walks the VFS via the EXISTING `node:fs` builtin (`readdirSync` withFileTypes / `statSync` / `readFileSync`) and matches lines with the JS RegExp engine — in-realm, zero spawn. Respects layer rules (lives in runtime-* layer, imports only its own `builtins/fs.ts`). Implements Q-2026-05-30-061 provisional decision; mark `TODO(ADR): Q-2026-05-30-061`.
   - **FAILING test to write first:** `packages/runtime-js/src/utils/vfs-grep.test.ts` — unit test 'vfsGrep returns 1-based line and column for a known match': seed `syncMirror` with `/work/x.ts` containing `'const foo = 1\nconst bar = 2'`, assert `vfsGrep('bar','/work') === [{path:'/work/x.ts', line:2, column:7, text:'const bar = 2'}]`. Write this FIRST; it fails because `vfs-grep.ts` does not exist (import error), then implement until green.
   - **Files:** `packages/runtime-js/src/utils/vfs-grep.ts`, `packages/runtime-js/src/utils/vfs-grep.test.ts`
   - **Test kind:** unit

3. **T3 — vfsGrep failure-mode contracts (unit).** Pin the failure-mode contracts of `vfsGrep` that the off-happy-path callers depend on: `maxResults` truncation (bounded walk), `ignoreCase`, include-glob filter, recursive descent into subdirs, and ENOENT propagation when root is missing (must surface the `node:fs` ENOENT, not swallow it — no silent stub). Each assertion catches a specific articulated failure mode (off-by-one line numbers covered in T2; unbounded walk; missing-file masking).
   - **FAILING test to write first:** `packages/runtime-js/src/utils/vfs-grep.test.ts` — add 'vfsGrep stops at maxResults' (seed 5 matching files, call with `{maxResults:2}`, assert `result.length===2`); 'vfsGrep ignoreCase matches mixed case'; 'vfsGrep include filter only scans matching paths' (`include:'*.ts'` skips `/work/x.md`); 'vfsGrep throws ENOENT for a missing root' (`expect(()=>vfsGrep('x','/nope')).toThrow` with code ENOENT). Write each assertion before its branch exists; they fail against the minimal T2 impl, then extend `vfs-grep.ts` until green.
   - **Files:** `packages/runtime-js/src/utils/vfs-grep.ts`, `packages/runtime-js/src/utils/vfs-grep.test.ts`
   - **Test kind:** unit

4. **T4 — Pin the spawn ceiling (conformance).** Pin the IMPOSSIBLE side as a behavioral contract, not prose: assert rifty's spawn ceiling. `spawn('bash',...)` and `spawn('git',...)` go through the same-realm fallback (`child_process-exec.ts:54-58`), which emits `'spawn <cmd> ENOENT\n'` on stderr and closes with exit code 127 — they DO NOT fake-succeed. This pins the substrate every impossible opencode tool (`Git.run->ChildProcess.make('git')`, bash tool, ripgrep binary) transitively hits. opencode is NOT vendored; we test rifty's spawn boundary, which is the correct substrate. Conformance level (rifty-specific browser-ceiling contract, not Node-parity — Node WOULD spawn git, so a parity diff is wrong here). Implements Q-2026-05-30-063.
   - **FAILING test to write first:** `packages/runtime-js/src/builtins/child_process-ceiling.test.ts` — 'spawn(\'git\',[...]) surfaces ENOENT-127 and never fake-succeeds': `const ch=spawn('git',['status'])`; collect stderr; await close; assert `exitCode===127 && stderr includes 'spawn git ENOENT'`. Add identical assertion for `spawn('bash',['-c','echo hi'])`. Add 'child.stdin.write throws NotImplementedError on the in-realm fallback'. Write FIRST; fails if any path fake-succeeds, locking the documented no-shell behavior (`child_process.ts:20-21`).
   - **Files:** `packages/runtime-js/src/builtins/child_process-ceiling.test.ts`
   - **Test kind:** conformance

5. **T5 — Authoritative boundary doc (documentation).** Write the authoritative FEASIBLE-vs-IMPOSSIBLE tool boundary doc in the compat source-of-truth (`docs/compat` per CLAUDE.md ordering), cross-linked from `docs/opencode-rifty-feasibility-2026-05-30.md`. ✅ feasible read substitutes: file read (`node:fs.readFileSync` over VFS), VFS search (`vfsGrep` — this feature), directory listing (`readdirSync`), stat, glob. ❌ fundamentally impossible (design TO them): bash/shell spawn, native git spawn (`Git.run->ChildProcess.make('git')`), ripgrep BINARY, PTY (`#pty` native C++). Note ripgrep-WASM / isomorphic-git are DEFERRED behind explicit ADR ratification (Q-2026-05-30-061 second decision). Implements Q-2026-05-30-062. Documentation-only — explicitly reversible per CLAUDE.md.
   - **FAILING test to write first:** No automated test (pure documentation, the 'always reversible' category in CLAUDE.md). Verification is manual: the doc rows MUST match what T2/T3 prove feasible and what T4 proves impossible — review that every ❌ row corresponds to a spawn/native dependency pinned by T4 and every ✅ row corresponds to an fs API exercised by T1/T2. No test file is added solely to cover prose (CLAUDE.md: do not add tests just to bump coverage).
   - **Files:** `docs/compat/opencode-tool-ceiling.md`, `docs/opencode-rifty-feasibility-2026-05-30.md`
   - **Test kind:** unit (documentation; no test added)

6. **T6 — Bookkeeping: OPEN_QUESTIONS + CHANGELOG (documentation).** Record the two REVERSIBLE provisional decisions in `OPEN_QUESTIONS.md` and the one decision flagged for human ratification. Add Q-2026-05-30-061 (pure-JS marker chosen over ripgrep-WASM), Q-2026-05-30-062 (boundary doc lives in `docs/compat`), Q-2026-05-30-063 (spawn-ceiling pinned by conformance test). Update affected packages' `CHANGELOG.md` (runtime-js). Per DoD: OPEN_QUESTIONS updated for provisional decisions; no ADR added here because no IRREVERSIBLE decision was MADE — the ripgrep-WASM/isomorphic-git dep is explicitly DEFERRED, not adopted.
   - **FAILING test to write first:** No test (bookkeeping: OPEN_QUESTIONS + CHANGELOG, the 'always reversible' documentation category). Verification: `pnpm todo:adr` count includes the new `TODO(ADR): Q-2026-05-30-061` marker placed in T2's `vfs-grep.ts`, and each Q-id referenced in code/docs has a matching OPEN_QUESTIONS entry.
   - **Files:** `OPEN_QUESTIONS.md`, `packages/runtime-js/CHANGELOG.md`
   - **Test kind:** unit (bookkeeping; no test added)

### Scaffolding sketch

```ts
// packages/runtime-js/src/utils/vfs-grep.ts  (PRIVATE helper — NOT exported via src/index.ts; runtime-* layer)
// Pure-JS, in-realm, zero process spawn. Walks via the existing node:fs builtin over syncMirror().
// TODO(ADR): Q-2026-05-30-061 — pure-JS marker tool; ripgrep-WASM deferred behind ratification.
import { readdirSync, readFileSync } from '../builtins/fs.ts'; // existing surface, no new builtin
import { joinPath } from '@rifty/vfs';

export interface VfsGrepMatch { path: string; line: number; column: number; text: string }
export interface VfsGrepOptions { include?: string; maxResults?: number; ignoreCase?: boolean }

// Walks `root` recursively (readdirSync withFileTypes -> recurse dirs, readFileSync utf8 on files),
// matches each line against `pattern`; line/column are 1-based (Node/ripgrep convention).
// Throws the underlying node:fs ENOENT (no silent stub) when `root` does not exist.
export function vfsGrep(
  pattern: string | RegExp,
  root: string,
  opts?: VfsGrepOptions,
): VfsGrepMatch[];

// READ substitute needs NO new function — it is exactly the existing fs surface:
//   readFileSync(path, 'utf8') | fs.promises.readFile(path) | readdirSync(path,{withFileTypes:true}) | statSync(path)

// IMPOSSIBLE side — ASSERTED, not implemented. No code change to child_process.ts:
//   spawn('git'|'bash', ...) -> child_process-exec.ts:54-58 -> stderr 'spawn <cmd> ENOENT\n', exit 127 (no fake-success).
//   child.stdin.write/.end -> InRealmStdinUnsupported throws NotImplementedError (child_process.ts:76-89).
//   #pty stub throws on session create — owned by feature 04, NOT this feature.

// tools/node-parity-runner/cases/fs/recursive-read.case.ts
// const c: ParityCase = { setup: { files: {...} }, code: `...recursive readdir + readFileSync...` }; export default c;
```

### Risks

- The T1 read-parity case may pass on first run (the fs builtin already matches Node). That is acceptable: its value is as a permanent regression pin for the read substitute, NOT as an initially-failing test. The genuinely test-first (red-first) tasks are T2/T3 (`vfs-grep.ts` does not exist) and T4 (no ceiling test exists). Flagging so the executor does not 'manufacture' a failure by mangling the case.
- Column/line indexing convention (1-based vs 0-based) is a real off-by-one trap; T2 fixes it to 1-based to match ripgrep/Node grep output so the marker is faithful to what it substitutes. If a later integration expects 0-based, that is a REVERSIBLE tweak.
- include-glob support in T3 is minimal (suffix/extension match), not full glob. Logged under Q-2026-05-30-061; do NOT pull a glob dependency (minimatch) — that would be IRREVERSIBLE by rule 2 and is out of scope for a marker.
- The spawn-ceiling assertion (T4) depends on the same-realm fallback path being taken. `spawn()` routes to the Worker path ONLY for `command==='node'` with a script arg AND SAB+workerUrl wired; 'git'/'bash' always hit `spawnViaSameRealm -> child_process-exec` ENOENT-127. If a future change made non-node commands take a different path, T4 would catch it — which is the point. Confirm under the unit test env (no kernel worker url) the path is deterministic.
- Scope creep toward ripgrep-WASM 'for fidelity': this is the one tempting drift OVER the ceiling line. It is feasible to RUN (WASI like esbuild) but crosses the reversibility line (new vendored binary = IRREVERSIBLE rule 2). The plan deliberately stays pure-JS; adopting ripgrep-WASM requires the ADR named in the ratification gate.
- opencode is NOT vendored, so the impossible side is proven on rifty's substrate (spawn ceiling), not end-to-end against opencode's real `Git.run`. End-to-end belongs to the later WebContainers tool-substitution integration; do not attempt to vendor opencode in this feature.

### Estimate

1.5 evening-units (T2+T3 the JS grep tool + tests ~0.75; T1 parity case ~0.25; T4 ceiling conformance test ~0.25; T5+T6 docs/bookkeeping ~0.25). All implementation tasks (T1–T4) are UNBLOCKED — they touch only rifty-side feasible primitives and existing ceilings, no deferred dep.

### Ratification gate

NONE blocks THIS plan. The feature is built entirely on the pure-JS / existing-`node:fs` path and asserts the existing spawn ceiling — no new external dependency is adopted (Q-2026-05-30-061, -062, -063 are all REVERSIBLE provisional decisions, logged in OPEN_QUESTIONS, no ADR required to start).

**⚠️ WARNING — HOWEVER one IRREVERSIBLE decision is DEFERRED and must NOT be silently crossed during implementation:** adopting ripgrep-WASM / isomorphic-git / wa-sqlite as the marker tool is IRREVERSIBLE by reversibility rule 2 (new external dependency) and is flagged needsHumanRatification. If a future effort wants real ripgrep fidelity, that effort is BLOCKED until the ADR 'read-only tool substitutes for the opencode facade — JS-first, ripgrep-WASM/isomorphic-git deferred' is ratified. This plan deliberately stays on the feasible side of that gate.
