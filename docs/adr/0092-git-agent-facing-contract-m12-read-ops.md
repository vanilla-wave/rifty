# ADR 0085: Agent-facing `git` contract in the M12 opencode bash channel — structured read-ops tool, write-ops NotImplementedError, impl deferred

Status: Accepted (2026-06-06)
Date: 2026-06-06

## Context

opencode (anomalyco/opencode) lands in rifty as a **no-tool-execution server facade** (M12; `docs/opencode-rifty-feasibility-2026-05-30.md`, tool-ceiling `docs/compat/opencode-tool-ceiling.md`). `git` is the agent's single most-emitted execution command (research §5 row `git`, demand **T1**; §9 git risk). But real opencode's `Git.run` shells out to the **git binary** via `child_process.spawn`, which a browser/WASI realm cannot do — pinned IMPOSSIBLE by the spawn ceiling: any non-`node` command falls through `execScript` → `spawn <cmd> ENOENT` exit **127** (`packages/runtime-js/src/builtins/child_process-exec.ts`), enforced by the conformance contract Q-2026-05-30-063 (`git`/`bash` → ENOENT-127, never exit 0).

Pure-JS git (isomorphic-git / wasm-git) is a **NEW external dependency = IRREVERSIBLE** (reversibility rule 2) and is currently **DEFERRED** — Q-2026-05-30-061 option C, also listed Deferred in the tool-ceiling doc. So `git` cannot be *implemented* this run.

But (research §9): if `git` simply 127s every turn, `git status`/`git diff`/`git log` — the agent's most-emitted reads — fail on every turn and the **bash channel's value collapses**. The implementation can stay deferred; the **agent-facing contract must be decided now** so the M12 bash-channel + facade tool layer are designed around a known shape, not an accidental 127. This ADR fixes that contract. It does **not** un-defer isomorphic-git and does **not** introduce any git-binary spawn (Q-2026-05-30-063 stays green).

The fork is a public-cross-package facade contract for the highest-demand T1 command → **IRREVERSIBLE** per the research §8 Q-git row.

## Decision

**Adopt option (b): `git` read-ops are served by a STRUCTURED facade TOOL, not by shelling out to a `git` binary.** Fix the contract now; implementation deferred behind Q-2026-05-30-061's isomorphic-git ratification.

1. **Surface = facade tool, not shell spawn.** `git status` / `git diff` / `git log` resolve via the opencode facade tool layer (the same in-realm `node:fs`-over-VFS substitution model as `vfsGrep`, tool-ceiling §Feasible) — a pure-JS read over the VFS backed by isomorphic-git **read** operations. They are answered as structured tool results; the literal string `git …` is **never** routed to `child_process.spawn`. The spawn ceiling is untouched: a raw `spawn('git', …)` still 127s (Q-2026-05-30-063).

2. **Read-ops covered (contract the eventual impl must satisfy):**
   - `git status` — porcelain-equivalent: per-path worktree/index state (untracked / modified / staged / deleted), current branch, ahead/behind when cheaply derivable.
   - `git diff` [`--staged`] [`<path>`] — unified-diff text vs working tree / index.
   - `git log` [`-n N`] [`<path>`] — commit list: sha, author, date, subject (+ body on request).
   These three are the agent's most-emitted (research §5, §8 Q-git, §9). Backed by isomorphic-git read ops (`statusMatrix`, `log`, `readBlob`/`readCommit`), zero spawn.

3. **Structured output shape (the load-bearing contract):** each read-op returns a **structured object**, not just a rendered string. Minimum shape the impl must satisfy:
   - `status`: `{ branch: string, ahead?: number, behind?: number, files: Array<{ path: string, index: 'unmodified'|'modified'|'added'|'deleted'|'untracked', worktree: 'unmodified'|'modified'|'deleted'|'untracked' }> }`
   - `diff`: `{ patch: string }` (unified diff) plus the originating `{ staged: boolean, path?: string }`.
   - `log`: `{ commits: Array<{ oid: string, author: { name: string, email: string, timestamp: number }, message: string }> }`.
   A human-facing text rendering (for the playground terminal) is derived **from** the structured result, not the source of truth — so the tool channel and the terminal stay one walker (mirrors the Q-grep-home "single home" intent). Exact field names are an implementation detail the impl session may refine; the **invariant** is: structured-first, derive text, no spawn.

4. **Write-ops remain `NotImplementedError` + compat ❌.** `git commit`, `git push`, `git pull`, `git fetch`, `git merge`, `git checkout -b`, `git add` (mutating index), and any remote interaction throw `NotImplementedError('git.<subcommand>')` and register `❌`. **No fake remote, no fake commit** (option (c) rejected — violates the no-silent-stub hard rule). Honest failure beats a dishonest success that desyncs the agent's mental model of the repo.

5. **Compat-matrix posture.** The tool-ceiling doc's Deferred row for isomorphic-git records that the **read-ops contract is ratified (this ADR)** while the dependency stays gated by Q-2026-05-30-061; read-ops listed as `⚠ contract-fixed / impl-deferred`, write-ops as `❌ NotImplementedError`, git-binary spawn stays `❌ ENOENT-127`.

6. **Implementation gate unchanged.** Adopting isomorphic-git is still IRREVERSIBLE and still requires ratifying Q-2026-05-30-061 (its own ADR). This ADR commits only to the **shape** that eventual impl must satisfy; it adds **nothing** to any `package.json`.

## Alternatives considered

- **(a) `git` → `NotImplementedError` + compat ❌ (whole command).** Honest and zero-dep. Rejected as the *contract*: it makes `git status`/`diff`/`log` 127 every turn, collapsing the bash channel's agent value (research §9) and giving M12 nothing to design the facade around. Honesty is preserved where it matters — the **write** side keeps exactly this behavior.
- **(b) Structured read-ops tool via isomorphic-git read ops — CHOSEN.** Serves the most-emitted commands through the feasible in-realm substitution model (tool-ceiling §Feasible), keeps the spawn ceiling intact, and lets write-ops fail honestly. Fixes the contract without un-deferring the dependency.
- **(c) Stub commit/push to a fake remote.** Rejected outright — **violates the no-silent-stub hard rule** (CLAUDE.md): returning fake success for a mutation the realm cannot perform creates exactly the subtle downstream desync the rule exists to prevent.
- **Literal-shell `git` via a future binary spawn.** Out of the question — pinned IMPOSSIBLE by Q-2026-05-30-063 and the architecture non-goal (no process spawn).

## Consequences

- M12 bash-channel + facade tool layer are designed against a **known git shape** (structured read-ops, honest write failures) instead of an accidental 127.
- The agent gets `git status`/`diff`/`log` as structured results once the deferred impl lands; until then those three are a **defined contract** (compat `⚠ impl-deferred`), not a surprise — and write-ops are a **defined `❌`**, so the agent fails loudly and predictably rather than acting on a fake commit.
- The spawn ceiling stays a behavioral contract: Q-2026-05-30-063 conformance stays green (raw `spawn('git')` still 127).
- Isomorphic-git is **not** adopted here; the dependency commitment stays with Q-2026-05-30-061. Risk: the structured shape above is fixed before the impl exists — mitigated by keeping it to the minimal, well-understood isomorphic-git read surface (`statusMatrix`/`log`/`readBlob`); the impl session may refine field names, not the structured-first/no-spawn invariant.
- Two consumers (facade tool + playground terminal) share one read-ops home (text derived from structured result), pre-empting the two-path divergence the research warns about for grep (Q-grep-home).

## Reversibility classification

**IRREVERSIBLE.** Highest-demand T1 command; whichever answer is chosen, the downstream M12 bash-channel and facade tool-layer design depend on it (checklist rule 1 — public cross-package facade contract; and it gates the eventual rule-2 isomorphic-git dependency). Hence an inline ratified ADR rather than an OPEN_QUESTIONS entry. Supersedes nothing; cites Q-2026-05-30-061 (defers impl), Q-2026-05-30-062 (compat posture location), Q-2026-05-30-063 (spawn ceiling kept). Sibling M12-coreutils ADRs: 0081 coreutils strategy, 0082 CommandContext shape, 0083 VFS cp/mv, 0084 tokenizer+glob, 0086 parity harness.

## Acceptance

- [ ] git **read-ops contract documented**: `status`/`diff`/`log` subcommands + their structured output shapes, served via the facade **tool** layer (not shell spawn).
- [ ] git **write-ops** (`commit`/`push`/`pull`/`fetch`/`merge`/`add`/`checkout -b`) specified to throw `NotImplementedError('git.<subcommand>')` + compat-matrix `❌`; **no fake remote/commit** (no-silent-stub honored).
- [ ] **No git-binary spawn introduced** — Q-2026-05-30-063 conformance stays green (`spawn('git')` → ENOENT-127, never exit 0).
- [ ] **isomorphic-git NOT added to any `package.json`** this run; impl stays gated by Q-2026-05-30-061's ratification.
- [ ] tool-ceiling / compat doc posture updated: read-ops `⚠ contract-fixed/impl-deferred`, write-ops `❌`, git-binary spawn `❌ ENOENT-127`.
- [ ] read-ops single shared home (text derived from structured result) so facade tool + terminal don't diverge.
