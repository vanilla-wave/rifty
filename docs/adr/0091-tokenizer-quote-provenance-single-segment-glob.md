# ADR 0084: Rich token type (per-token quote provenance) + single-segment glob expansion

Status: Accepted (2026-06-06)
Date: 2026-06-06

## Context

`packages/shell/src/tokenize.ts` (`export function tokenize(line, env): string[]`) splits a line into argv-style tokens with POSIX-ish quoting + `$VAR`/`${VAR}` expansion. Output is bare `string[]` — **all per-segment quoting provenance is discarded**. `tokenize` is re-exported from `src/index.ts` (public API). `shell.ts` consumes it (`run` → `splitOnJoiners` → `runSegment` → `argv`).

Glob (`* ? [...]`) is deliberately NOT supported today (tokenizer comment + research §2). Coreutils don't glob — the **shell** does, expanding *before* argv reaches the builtin. Research §6 #4 / §9 establish: correct globbing requires distinguishing `grep '*.ts'` (quoted → literal, must NOT expand) from `grep *.ts` (unquoted → must expand). A bare `string[]` cannot carry that bit, so `grep '*.ts'` would be silently corrupted into a tree walk. Therefore glob is **not** a pure dispatcher-only addition — it co-changes the tokenizer's output contract.

The proven tree-walk already exists in `packages/runtime-js/src/utils/vfs-grep.ts` (recursive `readdirSync({withFileTypes:true})` walker). Single-segment glob reuses that pattern (~30–50 LOC) — no new dependency. Full `**`/brace expansion would need picomatch (new dep, IRREVERSIBLE; deferred per ADR-0088 Option D, no verified need).

This ADR settles research §8 **Q-glob-scope** and the quote-provenance half of §6 #4 / §9. It does NOT touch `CommandContext` (that is ADR-0089).

## Decision

1. **Richer token type.** Change `tokenize` to emit tokens carrying quote provenance instead of bare strings. Shape:
   - `Token = { value: string; quoted: boolean }` for words, where `quoted = true` iff any character of the resulting word came from inside `'…'` or `"…"` (i.e. a glob metachar in the word was quoted → suppress expansion for the whole word, matching bash).
   - Operator tokens (`> >> < | & && || ;`) stay distinguishable. The exported shape: `tokenize(line, env): Token[]` with `Token` exported from `src/index.ts`. Operators carry an `op` discriminator so `shell.ts` keeps splitting on them. The bare-`string[]` return is removed.
2. **Single-segment glob expansion in the dispatcher, AFTER tokenize.** In `shell.ts`, after env-prefix popping / before builtin lookup, each **unquoted** word whose `value` contains an unescaped glob metachar (`* ? [`) is expanded against the VFS tree using a hand-rolled single-segment matcher (`* ? [...]`, ~30–50 LOC over the `readdirSync` walker pattern from `vfs-grep.ts`, rewired onto the shell's `syncMirror()` field-form Dirent). Matches replace the word in argv (sorted, bash order). Quoted words (`quoted === true`) are passed through verbatim.
3. **No-match policy = bash nullglob-off: pass the literal pattern through unchanged.** If a glob matches nothing, the original pattern string is left in argv as-is (NOT zsh-style error, NOT dropped).
4. **Scope = single path segment only** (`*.ts`, `foo/*.log`, `[abc].txt`). Recursive `**`, brace expansion `{a,b}` / `{01..09}`, extglob are **deferred** to a future picomatch ADR (ADR-0088 Option D), gated on a verified `**` need. Unsupported metachar combos are treated as literal (pass-through), never half-expanded.

Ordering matches bash: env-expansion (tokenize) → quote removal (tokenize) → glob expansion (dispatcher) → argv.

## Alternatives considered

- **(a) Richer token type + dispatcher single-segment glob + pass-literal no-match [CHOSEN].** Correctly distinguishes quoted vs unquoted patterns; zero new dependency; reuses the proven `vfs-grep` walker; bash-faithful no-match. Cost: public-API change to `tokenize` ripples to all consumers.
- **(b) Keep `string[]`, glob without quote info [REJECTED].** Cannot distinguish `grep '*.ts'` from `grep *.ts`; would corrupt quoted patterns into tree walks — a silent correctness defect (research §9). The whole reason quote provenance is load-bearing.
- **(c) Add picomatch now for full `**`/braces [REJECTED / DEFERRED].** New external dependency = IRREVERSIBLE (checklist item 2) with no verified `**` need; hand-rolled single-segment covers `ls *.ts`/`rm foo/*.log`/grep `--include`. Reserved as an explicit ADR-gated upgrade (ADR-0088 Option D).

## Consequences

- **Public-API break:** `tokenize`'s return type changes from `string[]` to `Token[]`. Every consumer must adapt: `shell.ts` (`run` reads `.value`; `splitOnJoiners`, env-prefix popping, redirect extraction now operate on tokens), all shell unit tests, and any external `tokenize` caller. This is the IRREVERSIBLE part — accepted deliberately because glob correctness is impossible without it.
- **Glob is NOT a pure dispatcher-only change** — it co-changes the tokenizer (provenance) and the dispatcher (expansion). Two-file change, recorded here so it's auditable as one decision.
- New internal helpers in `packages/shell/src/` (single-segment glob matcher + tree walk over `syncMirror()`); no new package dependency; layer-clean (shell may use vfs).
- Env-expansion + quote-removal + glob ordering must stay bash-faithful; redirect targets and future pipe operands are tokens too — globbing a redirect target (`> *.log`) follows the same unquoted-expand rule.
- Pass-literal no-match means a typo glob (`ls *.xyz`, no match) reaches the builtin as the literal `*.xyz` → builtin reports its own ENOENT, matching bash nullglob-off.
- `**`/braces remain unsupported → literal pass-through (not an error), to be upgraded only via the deferred picomatch ADR.
- Sibling coupling: glob output feeds builtins whose argv contracts are in ADR-0088 (coreutils) / ADR-0090 (cp/mv); `CommandContext` shape is unchanged here (ADR-0089).

## Reversibility classification

**IRREVERSIBLE — checklist item 1** (public API between packages: the exported `tokenize` return type, consumed across the `@riftydev/shell` boundary by playground + test registrants). Recorded here as a ratified ADR per ADR-0063.

## Acceptance

- [ ] `grep '*.ts'` (single-quoted) and `grep "*.ts"` (double-quoted) reach the builtin as the literal `*.ts` — NOT expanded.
- [ ] `ls *.ts` / `rm foo/*.log` / `[abc].txt` expand against the VFS tree (sorted, bash order); `find -name '*.ts'` keeps its pattern literal.
- [ ] No-match (`ls *.xyz` with nothing matching) passes the literal pattern through unchanged (bash nullglob-off), builtin reports its own error.
- [ ] Recursive `**` and brace `{a,b}` are NOT expanded (literal pass-through), pending the picomatch ADR.
- [ ] Cross-package type check passes after `tokenize` returns `Token[]`; all consumers (`shell.ts`, tests, external registrants) compile against the new type — no `any`/`@ts-ignore`.
- [ ] `Token` type exported from `packages/shell/src/index.ts`; TSDoc on the new public type.
- [ ] Parity cases: quoted-vs-unquoted glob (`grep '*.ts'` vs `ls *.ts`), no-match pass-literal, multi-match sort order — per the harness chosen in ADR-0093.
- [ ] Existing tokenizer behavior preserved: single-quote literal, double/unquoted `$VAR`/`${VAR}` expansion, `${VAR:-default}`/`${#VAR}` still throw, operator tokens unchanged, no IFS word-splitting.
