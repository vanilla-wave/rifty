---
area: runtime-js
status: draft
title: "AsyncLocalStorage loses request context after await"
created: 2026-10-14
why: Real queue programs lose request identity after Promise suspension; documented sync-scope subset does not provide Node async-context behavior
sources: [tools/agent-bench/reports/summaries/2026-10-15-eval-v18-corrected/README.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/misc-stubs.ts]
---

## Context

PR341 corrected-proxy queue-clear:4 exact final programs fail Rifty ALS check,
pass identical trusted judge on Node24.16.0 + genuine yocto-queue1.2.2 original
archive/SRI.2other queue programs also fail on Node (AbortError), mixed causes.
Raw6after-code/Node observers retained in corrected96 source archive diagnostics;
no rewrite/rescore. This gap lies beyond npm/proxy/oracle handoff repairs.

Minimal real parity (`runInNode`/`runInRifty`, MemoryVfs/module loader), script
and exact results in source gzip; run `pnpm exec tsx` on extracted observer
(adapt absolute worktree imports). `als.run({id:'request-1'}, async callback)`
prints before/after `await Promise.resolve()`:

```
Node24.16.0: sync request-1 / await request-1 / outside absent
Rifty:      sync request-1 / await absent    / outside absent
```

Birth: misc-stubs `run` finally restores previous store when callback returns
its Promise, before resumed callback reads store. Existing code comments and
compat modules mark synchronous-scope subset; full async propagation absent.
Standing builtin hook-stub draft explicitly excludes ALS; this capture records
its separate continuation boundary, not duplicate createHook work.

Dedup: runtime-js titles/code, goal maps, traps and ADR declined concepts had
no ALS continuation item; events-static-surface notes separate ALS ceiling.
Boundary: owned async continuation→builtin context, observable-order/torn-state;
no transport event loss/replay assertion, no proposed new coordination mechanism.

## Next

Owner runtime-js; trigger program uses ALS after await/timer/microtask, or claims
Node async-context compatibility. Preserve sync subset; investigate native
continuation authority and honest unsupported behavior at pickup. No shim/
Promise-patch approximation or implementation selected by this draft.
