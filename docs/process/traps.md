# Traps — hard-won gotchas (agents + humans). One entry = symptom → cause → rule.

## Worktrees & git

- **worktree-absolute-paths**: Write/Edit with main-checkout absolute paths silently lands in the main repo → worktrees share object DB so Read works, Write hits wrong tree → root every path at the worktree; tell subagents the worktree root; after edits `git -C <main-repo> status` must show none of your changes.
- **worktree-stale-main-diff**: `git diff main...HEAD` over-scopes a PR (invents huge surface) → local `main` ref lags origin → pin base via `git merge-base origin/main <branch>`; authoritative surface = `gh pr view --json changedFiles,additions`.
- **worktree-pinned-stale-reads**: Read/grep return outdated code → worktree pinned to old commit while origin/main moved → before analyzing "current main" compare HEAD vs origin/main; read via `git show origin/main:<path>` or re-branch from origin/main.
- **isogit-tag-not-peeled**: annotated-tag checkout/reset corrupts ref graph (child commit gets tag-object parent) → iso-git `resolveRef` returns UNPEELED tag oid, `checkout`/`writeRef` write it raw → peel via `readCommit`/`readObject` (type `tag` → peeled oid) before any ref write or `^0`/`~0`.
- **bare-repo-head-default-branch**: `git init --bare` + push `main` green locally, CI clone "Could not find HEAD" → CI `init.defaultBranch` unset → HEAD→master dangling → always `git init --bare -b main`.
- **rebase-changelog-union**: long playground rebase stops on CHANGELOG.md every commit → each commit prepends same `[Unreleased]` region → pre-register `apps/playground/CHANGELOG.md merge=union` in `$(git rev-parse --git-common-dir)/info/attributes`; verify top after (union can interleave).
- **rebase-main-origin-spec-sweep**: CI reddens after rebase pulls a new main-origin spec hardcoding what your branch renamed → grep ALL test dirs (incl `tests/e2e-prod`) for renamed/removed symbols after any rebase/merge with main.
- **squash-before-big-rebase**: incremental rebase over a main that landed a big feature re-conflicts the same regions per commit → `git reset --soft $(git merge-base HEAD origin/main)`, one commit, single rebase pass; semantic-reconcile the incoming feature to your renames, typecheck pinpoints the rest.
- **merge-adr-number-collision**: `refs:check` "duplicate ADR number" after merging main → both branches took the same next number → renumber YOURS everywhere (title, adr README row, code comments, CHANGELOG, e2e specs); grep repo-wide `ADR-NNNN`.
- **merge-duplicate-class-member**: both sides touched one class → git silently keeps BOTH method defs (no conflict marker), later def shadows the fix → after merge grep duplicate method names in touched classes; keep main's version.
- **merge-stale-compat-tests**: main-origin compat/App tests assert the ❌ your branch turned ✅ → updating them to new reality is correct; re-scan main-origin specs asserting superseded state.
- **rerere-silent-hunk-drop**: rerere with shared rr-cache can produce a merge missing an entire wiring block — no markers, builds fine → after ANY merge, `git grep` the key new symbols from both sides.
- **gh-merge-delete-branch-worktree**: `gh pr merge --delete-branch` from a worktree errors "'main' is already used by worktree" → only gh's local cleanup failed, the merge LANDED → verify `state=MERGED`, never re-merge; `git push origin --delete <branch>` manually.
- **git-add-batch-abort**: pushed commit missing files though gates were green → `git add a b c` stages NOTHING if one pathspec is fatal (e.g. just-rm'd path) → never re-add a removed path in the same batch; after commit `git status --porcelain` must be clean.
- **git-add-A-agent-junk**: `git add -A` after subagent workflows commits junk dirs (relative-path fs probes land in worktree root) → stage scoped paths; `git clean -nd` before staging.

## PR / CI verification

- **lint-includes-format**: local "lint passed" fails CI on formatting → `pnpm lint` = `biome check .` (format too) → `npx biome check --write <changed>` then re-lint.
- **chained-exit-masks-failure**: `cmdA ; cmdB` reports only cmdB's exit → run lint/typecheck/tests as separate commands, check each exit.
- **tsbuildinfo-false-green**: typecheck green locally, CI tsc red → stale `.tsbuildinfo`; vitest type-strips, so a fake missing a new interface method passes tests → when extending an interface, grep ALL implementations/stubs.
- **refs-check-docs-prefix**: dangling cross-refs pass CI → refs:check lints only citations with literal `docs/` prefix; ADR globs resolve only with the area subdir (`docs/adr/<area>/NNNN-*`) → write refs with `docs/` prefix or `ADR-NNNN` form; when deleting a doc, grep the bare-path form too.
- **compat-matrix-half-generated**: hand edits to generated compat `.md`s/README vanish → `compat:generate` renders them from cli.js inventories → edit cli.js rows, not the `.md`; after generate, diff README + sibling `.md`s for unintended reverts.
- **build-libs-dirty-sw**: `build:libs` dirties the tree with a big `apps/playground/public/sw.js` diff → it regenerates the committed artifact from current sources (stale on main) → confirm none of your symbols in the diff, `git checkout HEAD --` it; re-revert after each build.
- **red-main-fails-green-pr**: green PR fails CI on files you never touched → CI checks the PR merged into current origin/main → reproduce on a temp worktree of bare origin/main; carry a minimal "unbreak main" commit in your PR.
- **ci-only-fail-merge-worktree-first**: "fails only in CI, green locally" → failing spec may exist ONLY in main (CI tests the merge) → FIRST build a merge worktree (`git worktree add /tmp/x HEAD --detach && git -C /tmp/x merge origin/main`) and run specs there; throttling hypotheses later.
- **automerge-no-required-checks**: `gh pr merge --auto` merges instantly → main has no required status checks → local `pnpm pr:check` is the real pre-merge gate (e2e is NOT in it; CI runs e2e separately).
- **prod-e2e-separate-gate**: prod-only owner-boot regression passes pr:check + dev e2e + unit/parity → `test:e2e:prod` (build+preview) is its own lane → run it for any owner-boot / worker-entry / env-read / chunk-graph change.
- **verify-committed-not-worktree**: gates prove the WORKING TREE, not the commit → uncommitted/unstaged edits keep gates green while the push misses files → re-run the decisive check on the committed state before push.
- **parity-runner-in-process**: parity cases run rifty builtins in-process in the Node host → `globalThis.process` is REAL Node; bare `Buffer`/`process`/`console`/`global` in a case is Node==Node tautology (false-green) → builtins resolving "the live process" must `instanceof NodeProcess` check; cases must `require('node:buffer')` etc. explicitly; RED-check by stashing `packages/`.
- **parity-win32-alias**: rifty ships `path.win32 === posix` → never parity-test `path.win32.*` (real Node diverges).

## e2e

- **stale-foreign-server-port**: e2e tests PRE-change code (phantom pass/fail) → `reuseExistingServer` grabbed a sibling worktree's dev server on default 5273 → always set a dedicated `RIFTY_PLAYGROUND_PORT`; `lsof -nP -iTCP:5273 -sTCP:LISTEN` when results look wrong.
- **pipe-masks-playwright-exit**: `playwright ... | grep | tail` returns tail's 0 → capture playwright's exit directly, never through a pipe.
- **project-first-boot**: `goto('/')` then expecting LIVE/`$ vite` hangs → cold boot shows the chooser, no auto-boot (only `?preset=` deep-link boots) → `pickStarter`/`selectPreset` first, or wait launcher visible + close it and use Terminal 1.
- **isvisible-doesnt-wait**: `locator.isVisible({timeout})` returns CURRENT state immediately → helpers no-op on a not-yet-open dialog → `expect(...).toBeVisible()` before acting; `selectPreset` must out-wait the 1s chooser timer or the veil intercepts the click.
- **reload-must-relaunch-dev-server**: post-reload restore shows tree but empty console/no preview → dev server is a pty that dies with the page; restart hook is gated on a session id that's null after fresh reload → restore branch must re-root owner AND relaunch dev server (ADR-0148); reload e2e must assert livepill running + preview, not just file/tab survival.
- **selector-e2e-misses-css**: wholesale-missing component CSS passes selector e2e + code review → selectors don't render pixels → for UI changes take a real screenshot and assert computed overlay geometry (fixed/centered), not selector presence.
- **force-click-silent-noop**: `click({force:true})` on a covered element dispatches into the overlaying layer = silent no-op (hang); without force = loud actionability error naming the coverer → never force-click buttons/menu items in e2e.
- **cross-file-contention-flake**: raising e2e workers re-flakes even with `describe.serial` → cause is CROSS-FILE contention (concurrent Vite-WASI cold-boots starve the owner worker: zero output, owner-RPC timeouts), not intra-file parallelism → heavy and light lanes must never overlap; a serialized lane runs long — don't mistake it for a hang; repro locally by oversubscribing `--workers`.
- **fix-flake-before-parallelizing**: shard/worker speedups lose → flake cost = readiness-timeout × retries dominates wall-clock variance, and sharding concentrates flaky specs into one inflated shard → fix the flake first; don't re-propose shards/`--workers` before that.
- **rejected-e2e-speedup-levers**: HAR/route WASM caching drops COOP/COEP → SAB undefined → green-but-broken; worker-scoped warm page dies under retries; in-page soft-reset breaks the reload contract; prebuilt V8 cache is per-context → don't re-propose these.
- **opfs-wipe-parallel-race**: owner/OPFS specs wiping per-origin storage can kill each other under fullyParallel CI → re-run the failed spec isolated (`--workers=1`) FIRST: isolated fail = real regression, isolated pass = the known race.
- **in-suite-fail-solo-pass**: heavy-lane spec fails in-suite, passes solo → contention, not the spec → run solo before "fixing" it.
- **e2e-runs-locally**: belief that COI blocks local e2e is wrong → playground vite config ships COOP/COEP, browsers installed → `npx playwright test --project=chromium <spec>` is the fastest RED→GREEN loop for owner/shell behavior.

## Browser runtime & bundling

- **worker-console-invisible**: worker-realm logs never reach page/Playwright console; BroadcastChannel is shimmed in workers → route diagnostics via `process.stdout.write`; an eval-crashed kernel worker shows only as `page.on('worker')` create→close ~0.1s apart (DOM `error`, no exit frame).
- **pre-entry-hook-lives-in-host**: refactoring runtime-js's install path silently breaks the browser → `setKernelPreEntryHook` is last-writer-wins and the playground `kernel-worker-entry.ts` registration is the one that runs (ADR-0157) → update the host hook with any shim refactor; failure = silent emnapi pthread crash, preview 503, only the SW-preview e2e catches it.
- **worker-entry-chunk-graph**: adding a kernel import to `runtime-js/worker-entry.ts` co-locates its side-effect into the kernel startup chunk → process globals install BEFORE the pre-entry seam publishes the spec → persistent empty-env clobber, prod-only → keep the env reads; prod e2e is the proof.
- **worker-entry-side-effect-realm**: a top-level `if (isWorkerRealm)` side-effect re-exported from a package index runs in EVERY consumer worker's realm → gate side-effects on a precise published signal (e.g. the wasi-guest spec key), never "am I in a worker".
- **prod-dual-copy-buffer**: prod-only `Buffer.isBuffer`/`instanceof` failures (etag TypeError) → each `?worker&url` bundle carries its own `@riftydev/io` copy; pre-entry `globalThis.Buffer` ≠ child `require('buffer')`; dev serves ONE module so it hides the class → `installBundleLocalBuffer()` per child realm; catch via `tests/e2e-prod` or grep the io marker per dist worker chunk.
- **browser-only-cant-red-in-node**: browser-only contract failures (e.g. `getRandomValues` rejects SAB-backed views) can't RED-check in node vitest → mock the browser contract (throwing spy) or find a Node-reproducible proxy on the same code path.
- **napi-wasi-loader-flags**: napi-rs loader silently swallows the wasm32-wasi load error → set `NAPI_RS_FORCE_WASI`; emnapi needs a Node `global` alias; Vite 8 dropped `optimizeDeps.disabled` → use `noDiscovery: true`.
- **solid-server-runtime-in-vitest**: node vitest resolves solid-js to the SERVER runtime — `createEffect` is a permanent no-op → modules with internal effects silently never subscribe (test timeouts, works in browser) → orchestration modules own no effects: explicit attach/dispose, App binds with a one-line createEffect (ADR-0197).
- **signal-read-leaks-tracking**: a module method reading signals inside a caller's `createEffect` gets tracked → resubscribe storm (LIVE pill fine, preview fetch times out deterministically) → `untrack()` INSIDE any public method that reads signals; unit tests can't catch it (server runtime has no tracking) — only e2e does.
- **template-literal-cooked-escapes**: code shipped inside template literals (preset templates, injected scripts, shim bodies): `\d` cooks to `d` (write `\\d`), a backtick in an added comment TERMINATES the literal → check for the enclosing backtick before editing; run the test that EXECUTES the generated string.
- **pty-snapshot-stale-cwd**: page-side session cwd is `/` until the first `pty:exit` → recording a RUNNING command's context from `manager.snapshot()` lies (`cd / && vite`, exit 127) → thread the owner's `ctx.cwd` onto the owner→page frame and prefer `frame.cwd`.
- **css-equal-specificity-dead-override**: an override block silently loses to a LATER equal-specificity block — dead from the day the later block was added → write two-class overrides (`.base.__variant`); diagnose geometry via `getComputedStyle` + `document.elementFromPoint`, not source CSS.

## Testing discipline

- **unit-green-masks-desync**: all phases unit-green, feature dead end-to-end → constant→dynamic refactors leave hardcoded stragglers that compile and unit-pass; App/owner integration isn't unit-testable → grep EVERY hardcode of the old value; the FULL e2e suite is the real gate.
- **default-timeout-load-flake**: red main after green PRs, failure ≈5000ms with NO assertion diff → real-Worker test hit vitest's default `it()` timeout under higher CI parallelism → explicit generous `it()` timeout; keep inner protocol bounds (e.g. `waitReplyAsync(2000)`) as the correctness guard.
- **count-ratchet-lossy**: count-only ratchet passes a same-count swap silently → a count is a lossy aggregate → carry an identity digest (hash of the sorted normalized-signature multiset) per allowlist entry.
- **write-ack-not-durable**: sleep barriers "proving" persistence lie → write-ack means applied to owner memory; the OPFS write-through drains behind it → prove durability with an acked flush IPC (durable-or-throw flush), never a timeout.

## Tooling wiring

- **new-toplevel-dir-invisible**: a new top-level dir (e.g. `services/`) is silently ignored → workspace/arch/test/backlog tooling hardcodes `packages|apps|tools` → wire 6 spots: pnpm-workspace glob, vitest unit include, `check:arch` args, arch-boundaries sweep, arch-rules carve-out, backlog SCAN_ROOTS; not in `build:libs`; publish build = hand-written tsup config.
- **pnpm-eats-double-dash**: `pnpm test:parity -- foo` drops the filter → pass args bare: `pnpm test:parity foo`.
