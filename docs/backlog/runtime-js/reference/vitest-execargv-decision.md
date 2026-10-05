# Independent execArgv decision

Reviewer: /root/exec_argv_decision, 2026-10-01; read-only repository review; no author diagnosis/verdict adopted.

## Authority and observed failure

- Accepted goal: docs/backlog/epics/vitest-run-in-browser/goal.md I4/I5/I6; both real pools, exact Vitest 4.1.11/Vite 8.0.16; no package patch. Mission/Fidelity + DEC-1/2 + REV-7 require real option effects and smallest carrier.
- /tmp/vitest-after-mutation.log: threads fails before tests at Worker.execArgv; fork success does not prove options parity. child_process.ts fork delegates to spawn and currently drops execArgv; process.ts only seeds eval execArgv.
- Exact installed Vitest cli-api.CnMVyzaz.js: resolveOptions lines 3798–3813 adds --experimental-import-meta-resolve and --require suppress-warnings.cjs; resolveConditions 3814–3830 adds project conditions; both ForksPoolWorker 3153 and ThreadsPoolWorker 3231 forward same raw array.
- node-entry runtime config exact v4 launch lacks program/worker execArgv; resolver has fixed conditions; esm-job-evaluation metaResolve ignores second argument; runNodeEntry currently creates entry loader without startup preloads.

## Decision

Keep ADR-0267's existing atomic entry envelope; migrate every producer/decoder to exact node-entry v5. Required execArgv readonly string array on program, eval, worker-thread launch; ordinary fresh programs explicitly send []. Single raw per-entry snapshot is authority; no second parsed settings record on the wire, env side channel, kernel option bag or handshake.

process.execArgv becomes a mutable COPY for every launch. Worker default snapshots immutable original launch execArgv, recursively; explicit opts.execArgv overrides, including []. fork default snapshots current public process.execArgv (different Node contract), with Node's default eval-source-pair removal; explicit fork override is independent. Snapshot before deferred startup; never reinterpret argv as Node options after guest mutation.

One generic Node-entry startup path derives supported behavior locally from that snapshot: --require/-r (separated and long equals), --conditions/-C (separated and long equals), --experimental-import-meta-resolve. Require preloads execute in order before user entry, using the SAME real loader/cache as entry. Conditions apply to both package exports and imports for require/import/meta.resolve, preserving package declaration-key order. Resolve-parent flag enables second import.meta.resolve parent URL, including relative targets and bare conditional package lookup. Loader configuration must remain per-entry/immutable; no mutable global conditions shared between loaders.

Source-bearing eval flags remain identity in path Workers; Node explicitly accepts ['-e',source] and does not replay source. Do not reject them as invalid Worker options or accidentally rerun eval. Unknown/unsupported valid flags stay named loud ceilings; invalid/missing operands and preload failures follow their observed phase. The same-realm fallback cannot claim isolated startup effects; keep unsupported effects loud there. Real physical Worker and fork paths must share startup behavior.

## Alternatives

1. KEPT, minimal interface: raw execArgv on existing versioned launch + locally derived loader configuration. Carries non-derivable CLI spelling/identity; no duplicate wire authority. Native probes show original versus overridden array identity, source-bearing eval identity, and three observable feature effects.
2. KILLED: normalized startup object only (conditions/preloads/resolve-parent). Loses exact raw execArgv spellings and eval source-bearing identity. Adding raw argv alongside normalized object creates two authorities although behavior is derivable; unnecessary under REV-7.
3. KILLED: NODE_OPTIONS/guest-env or kernel argv/KernelProcessSpec carrier. Changes guest env/process.argv and violates ADR-0267's channel separation / runtime-agnostic kernel. Existing ordered init already transports all required data.

## ADR treatment

- Partially supersede ADR-0339: retained exact program/worker variants, plus its require-preload loud gap for the supported require subset. Eval script identity, evaluation, print/lifecycle and still-unclaimed --import/ESM eval/REPL remain.
- Partially supersede ADR-0416: active node-entry v4 version only; SQLite deployment and dev-server protocol decisions remain.
- ADR-0267 is preserved and cited (separate guest env, host snapshot, fresh role; new version for shape changes), not overturned. DEC-2 dated active correction notes on partial predecessors; no deletion of either full ADR.

## Executed reference proof

Command: node vitest-execargv-probe.cjs
Raw script: vitest-execargv-probe.cjs
Raw output, exact per-case command/cwd/status: vitest-execargv-probe.txt
Reference: Node v24.16.0, executable recorded in log; fixtures recorded there.

- Worker default and nested worker: original array + custom conditions; parent/child public mutations ignored. fork-default: public mutation included and effective; explicit [] clears identity/preloads/custom conditions in both.
- Require preloads precede ESM import preload irrespective flag interleaving; duplicate preload shares cache; entry observes same cached object.
- Resolve second parent: flag absent resolves x.js/root pick; enabled resolves other/x.js and other/node_modules/pick/custom.mjs. Conditions also change #imports. Conditional key order wins over flag order (second before first yields second).
- Explicit Worker ['-e',source] and ['--input-type=module'] accepted and run path entry. Inherited eval flags preserved in Worker; default fork removes eval pair and retains public conditions mutation.
- Missing require/conditions operand and unknown Worker option: synchronous ERR_WORKER_INVALID_EXEC_ARGV. Missing preload module: asynchronous MODULE_NOT_FOUND with internal/preload require stack.
- Short separated and long equals require/conditions accepted; attached -rX/-CX CLI spellings rejected with status 9.

## Required product proof before GREEN

RED then differential cases against recorded Node: all three effects; raw identity/default/override/[]; recursive Worker ignoring public mutation versus fork using it; path Worker inherited/explicit -e without replay; ordered preloads/shared cache; exports + #imports declaration order; meta.resolve second parent relative and bare packages; invalid operands versus asynchronous missing/throwing preload, no entry side effect after preload failure. Exercise real Memory VFS/loader; physical recursive Worker and real fork acceptance, not mocked sibling packages. Protocol tests: v4/malformed/extraneous fields rejected, v5 dense-array snapshot isolated; all entry producers/duplicated bundles migrated.

Final e2e: existing exact Vitest scenario both pools, failing then fixed TS test, reporter/count/exit behavior; generic probes must also run so a superficially passing fork cannot hide dropped flags. This review establishes decision/reference evidence only; product implementation and GREEN not checked.
