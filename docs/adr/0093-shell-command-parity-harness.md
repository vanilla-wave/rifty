# ADR 0086: Shell-command parity-test harness strategy — node:fs reuse + frozen GNU fixtures, never a live host-spawn oracle

Status: Accepted (2026-06-06)
Date: 2026-06-06

## Context
Project policy (CLAUDE.md "Tests"; DoD): every Node-compatible behavior lands with a parity case; parity is the gold standard. The rich-terminal/coreutils work (research 2026-06-06 §8 Q-parity-harness, §9) adds shell builtins (ls/grep/find/head/tail/wc/sort/cut/tr/cp/mv/…), each with flags, each policy-bound to a parity case.

But the existing `tools/node-parity-runner` CANNOT be that oracle for shell commands. Confirmed by reading the harness:
- `run-in-node.ts` spawns `process.execPath` (or vendored `tsx` for `ts-esm`) on a `.js`/`.mjs`/`.ts` entry; `run-in-rifty.ts` runs the same source through `@riftydev/runtime-js/loader`. `types.ts` `kind` ∈ `cjs|esm|http|ts-esm|sqlite`. It compares JS-module stdout exercising `node:*` builtins.
- There is NO `kind` that drives `Shell.run('ls -la')`, and Node ships no `ls`/`grep`/`find` as a `node:*` module — so the harness has no oracle for a shell command. The "excellent parity story" (research §7 caveat, §9) is unsubstantiated until resolved.

A live host-coreutils oracle (`spawn('ls', …)`) is non-deterministic across dev machines: macOS BSD vs Linux GNU divergence, locale-dependent `sort` order, `-A` vs `-a`, `wc -m` vs `-c`, color/TTY heuristics. A gold oracle that disagrees with itself by machine cannot encode a contract.

Precedent: Q-2026-05-31-201 already treated the parity *Node-reference choice* as a recordable test-infra decision (full-transform tsx vs strip-only Node). Q-2026-05-30-063 established the "CONFORMANCE, not Node-parity" honesty framing when real Node would behave differently from the thing under test — directly applicable here.

## Decision
Choose a parity strategy PER COMMAND CLASS and record which in each case file:

1. **(c) `node:fs`-expressible filters → REUSE node-parity-runner.** Where a builtin's core logic is expressible as a deterministic `node:fs` JS script (the line/byte/sort logic of `wc`/`head`/`tail`/`sort`/`uniq`/`cut`/`tr`, `basename`/`dirname`/`realpath` path math), the parity case is a real `node:*` script whose stdout the harness already compares Node-vs-rifty. This is genuine live Node-parity — the gold tier; prefer it whenever the logic reduces to `node:fs`+`node:path`+string ops. The builtin and the parity script share the algorithm intent, not a flag-parser.

2. **(b) Otherwise → FROZEN GNU GOLDEN-FIXTURE snapshots.** For surface with no `node:*` analog (`ls -la`/columns/`--color`, `grep -rn` tri-state, `find` predicate output, GNU-specific flag formatting), the reference is a snapshot captured ONCE from a pinned GNU coreutils (version + locale `C`/`C.UTF-8` recorded in the fixture header), committed to the repo, asserted against `Shell.run` output. Honestly labeled **conformance against a frozen reference, NOT live Node-parity** (cf. Q-2026-05-30-063's "conformance not parity"): there is no Node oracle, and the fixture is captured, not regenerated per-run. The fixture is the gold source; regeneration is a deliberate, reviewed, version-bumping act — never an automatic re-capture.

3. **(a) A live host-coreutils spawn oracle → REJECTED as the gold source.** Cross-machine non-determinism (BSD vs GNU, locale, `-A`/`-a`, `wc -m`/`-c`) disqualifies it as the contract reference. Permitted only as an opt-in *dev convenience* (a developer on a known-GNU box may diff against local `spawn` while authoring) — it MUST NOT gate CI and MUST NOT be the committed reference.

Also ratified:
- **No silent stubs.** Every UNIMPLEMENTED flag throws `NotImplementedError('shell.<cmd>.<flag>')` and registers `❌` in the compat matrix. A flagless `ls` silently honoring `-R` (returning wrong/empty output) is strictly worse than throwing (research §9). The parity/fixture suite asserts the throw for unimplemented flags.
- **Document known GNU-divergences in the compat matrix:** locale-dependent `sort` order, byte-vs-char (`wc -c` vs `-m`), `-A` vs `-a`, hidden-file/`-prune` subtleties, hand-rolled `LS_COLORS` ≠ `$LS_COLORS`, ASCII-only column width (no wcwidth). Each is a recorded, intentional limitation, not a silent diff.
- **Future WASI path (ADR-0088 Option B, uutils):** uutils `ls`/`find`/etc. parity uses this SAME chosen oracle (node:fs reuse where applicable, else the frozen GNU fixture) BEFORE rifty relies on the WASM applet — the cutover (today's flagless `ls` → uutils honoring `-la --color`) is gated on green fixtures, updated without weakening (research §4 B, §9).

## Alternatives considered
- **Live host-spawn oracle as gold (rejected option a):** highest apparent fidelity, but the host's coreutils is the very thing that diverges machine-to-machine; CI on a GNU runner would silently encode GNU-isms that fail on a contributor's macOS BSD box, and locale would float the contract. A self-disagreeing oracle is not a contract. Kept only as non-gating dev aid.
- **Skip parity for shell builtins, unit-assert only:** violates the parity-is-gold-standard rule; loses the frozen-GNU behavioral anchor for formatting-heavy commands. Rejected.
- **Force-fit everything through node-parity-runner by writing `ls`/`grep` as `node:fs` scripts:** works for filter logic (that IS option c), but a `node:fs` reimplementation of `ls -la` column/color formatting would be re-deriving GNU's output, not referencing it — the reimplementation, not GNU, becomes the oracle, defeating the purpose. Use frozen GNU fixtures for that class instead.
- **Frozen fixtures for everything (drop option c):** loses genuine live Node-parity where it's freely available (filter logic), weakening the strongest tier for no gain. Rejected in favor of the per-class split.

## Consequences
- Each shell builtin/flag PR lands with EITHER a reused node-parity case (filters) OR a committed frozen-GNU fixture (formatting/grep/find/ls), and the case file states which tier + (for fixtures) the pinned GNU version + locale.
- The research's "parity story" is now substantiated and honest: live-parity where a Node oracle exists; explicitly-labeled frozen-reference conformance elsewhere — no overclaiming "parity" for the latter.
- Unimplemented flags are walled off as throwing `❌` entries; no flagless command silently mishandles an unknown flag.
- GNU-divergence notes live in the compat matrix, so a fixture mismatch on a known divergence is an expected, documented limitation, not a mystery red.
- node-parity-runner stays unchanged for this decision — no new `kind`, no `Shell.run` mode added by THIS ADR; reuse path uses existing `cjs`/`esm` kinds. (A future ADR may add a shell-driving kind if a command's behavior genuinely needs `Shell.run` semantics rather than its underlying fs logic; out of scope here.)
- Fixture regeneration is a reviewed, version-bumping act; a "just re-capture to make it green" shortcut is a test-weakening defect (CLAUDE.md never-modify-a-test invariant applies to the frozen reference too).
- Cost: capturing/committing GNU fixtures (one-time per command, pinned toolchain) + maintaining the divergence notes. Accepted as the price of a deterministic gold source.

## Reversibility classification
**Recordable test-infra decision — recorded as an ADR (not OPEN_QUESTIONS).** Touches `tools/` (parity harness + fixtures) and test files only; NOT a package `src/index.ts` public API, NOT a new runtime dependency (capturing fixtures from an external GNU coreutils is a one-time authoring step, not a vendored runtime artifact — distinct from ADR-0088 Option B's binary). By the reversibility checklist this is REVERSIBLE in mechanism. Recorded as an ADR rather than OPEN_QUESTIONS because it sets a precedent that every coreutils PR depends on (the per-class tier choice + the no-silent-stub-flag rule), mirroring the Q-2026-05-31-201 / Q-2026-05-30-063 precedent that parity-reference choices are durable enough to record. Reverting (e.g. adopting a live oracle later) would require a superseding ADR citing this one.

## Acceptance
- [ ] A landed shell builtin/flag ships with EITHER a reused node-parity case (filter logic over `node:*`) OR a committed frozen-GNU golden fixture; the case file documents which tier and, for fixtures, the pinned GNU coreutils version + locale.
- [ ] No committed shell-command reference is produced by a live host `spawn` of coreutils; any `spawn`-diff tooling is opt-in and non-gating.
- [ ] Every unimplemented flag throws `NotImplementedError('shell.<cmd>.<flag>')` and is registered `❌` in the compat matrix; a test asserts the throw.
- [ ] Known GNU-divergences (locale sort order, `wc -c` vs `-m`, `-A` vs `-a`, `LS_COLORS`, ASCII-only column width) are captured as notes in the compat matrix.
- [ ] For the future WASI/uutils path (ADR-0088 Option B), `ls`/`find`/etc. pass against this chosen oracle before rifty routes to the WASM applet.
