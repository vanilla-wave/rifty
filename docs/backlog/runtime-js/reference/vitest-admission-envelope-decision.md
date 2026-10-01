# Independent decision: finite Vitest run/info envelope

2026-10-02. Read-only repo, depth 1, no children. Product unchanged.

## Recommendation

Keep finite admission: canonical raw-first `run` actions, plus exact root informational invocations. Do not present public `parseCLI` as a pure or complete effective-command classifier.

For `args[0] === 'run'`, call the installed public native helper once. If native parsed `help` is truthy, its real help has already been emitted: report **entry handled** through the existing before-entry result and return from `runNodeEntry` without importing the CLI again. Then let ordinary lifecycle drain/exit run. If help is false, continue admission checks and real installed entry. In particular, parsed `version:true` here is not an informational completion.

For exact single-token root `--help`, `-h`, `--version`, `-v`, bypass the helper entirely and run the real unchanged installed entry once. These are proven safe native info shapes. Further finite info tuples may be added only with a discriminating oracle; do not infer "info" from raw occurrence of a flag, nor require an exhaustive info grammar for this goal.

Outside these envelopes, throw an honest named admission-shape ceiling (`vitest.cli-shape`/equivalent), unless an independently proven watch request is specifically rejected as `vitest.watch`. No argv rewrite, console interception/suppression, fabricated help/version, private hashed-chunk import, or upstream patch. The canonical negative `vitest --watch` still throws `vitest.watch`. Native helper output plus handled return is actual native semantics, not a fake owner command.

## Why this boundary is honest

Authority: user-owned goal I4 requires `vitest run`, same command with pool/reporter options, npm test; I7 requires watch and named out-of-claim modes loud. It does not require all equivalent permutations, all cac actions or every info spelling. I6 real installed modules/native parser on claimed path remains. ADR-0174/its finite-admission successor preserves native parser/config behavior within admitted envelope; it does not silently expand that envelope to arbitrary CLI grammar.

Thus declining `--pool=threads run` is conservative finite admission, not weakening I4: `run --pool=threads` remains supported. Document the boundary explicitly; do not label the declined permutation "watch" or claim its native behavior is unavailable. Once supported forms are claimed publicly, new silent narrowing would need distinct authority. No such source obligation was found for pre-command permutations in the accepted goal.

Do not constrain every tail option/filter of canonical `run` merely to avoid help duplication: native helper + handled result already resolves this, preserving installed native grammar with little machinery. A full command matcher copied from cac is unnecessary. A broad raw `--help`/`--version` bypass is unsafe: false flags, values, delimiter placement, and named version differ.

## Discriminating evidence

Raw Vitest 4.1.11 `cac.uFydS1Z4.js`:

- Cac.parse :500-551 parses/matches command even when `{run:false}`.
- :535-539: truthy help prints real matched help, disables action and clears match.
- :540-544: version prints/disables action only if `matchedCommandName == null`.
- :2293-2295: public parseCLI calls that parser with run:false, then adds run/watch based on raw first CLI token; it does not return actual matched command.
- :2311-2317: actions set watch/run; action behavior is absent from parseCLI projection.
- :2215+: help formatting consults actual process.argv, not only parseCLI's input argument.

Existing `/tmp/vitest-cli-info-oracle.log` demonstrates parseCLI's real output side effects. `/tmp/vitest-info-compare.cjs` compares a `node -e` helper with real CLI; help mismatch there comes from *different process.argv*. It does not prove helper help differs in the real worker, whose process.argv is already the unchanged launch argv.

Executed fresh `/tmp/vitest-envelope-info-probe.cjs` this session; data `/tmp/vitest-envelope-info-probe.json`. Node v24.16.0 / Vitest 4.1.11 / Vite 8.0.16. Helper subprocess assigns exact same process.argv as native CLI, invokes installed public parseCLI, compares emitted stdout to installed CLI. No env reads/overrides.

| argv | observation |
|---|---|
| run --help | native helper stdout exactly equals actual CLI; both exit 0 |
| run -h | same |
| run --pool=threads --help | same |
| run --watch --help | same; real help supersedes watch action |
| run --help --expand-help | same |
| run --version | helper emits nothing; real CLI executes RUN, fixture exits 1 |
| --reporter=verbose run | helper lacks raw-first run inference; real CLI executes RUN |
| --pool=threads run | same discrepancy |

`/tmp/vitest-cli-admission-e2e.log`: existing implementation has browser GREEN for required fail/fix/forks/threads/npm/verbose plus watch/vm negatives (1 passed, 53.8s). It does not prove info handling or pre-command permutations.

## Integration constraint

Handled return means "native entry behavior already completed by the installed helper". Add the smallest explicit return disposition at the already-added `beforeEntry` seam; default means continue. It introduces no registry, ledger, protocol, coordination or owner command. Update that seam's existing ADR/public contract for this return meaning.

Do not call `process.exit(0)` to consume help. Native info is ordinary top-level completion: preload exitCode, exit listeners and live timer/Worker refs still apply. Returning through normal lifecycle preserves those facts; force-exit does not. A process.exit() callback is not equivalent either when preload refs remain.

Required verification before info claim: actual browser helper-help once, root info once, canonical run unchanged, run --version remains action, helper parser output naturally reaches foreground stdout, normal completion retains existing preload/exit behavior. Do not broaden source tests solely for speculative extra CLI forms.

Status: decision/evidence complete; product/info browser behavior not checked by this agent. No goal amendment required; original I4/I7 remain unchanged.
