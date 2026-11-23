# pi 0.85.1 → 1.6.0 — core-v1 before/after (text core, ADR-0532)

Same endpoint (gpt-6-luna via codex-proxy), limits (40 tools / 600 s), port 5397,
config `configs/gpt-6-luna.json`, 6 tasks × 3 Pi lanes × 3 trials. Baseline
[`../2026-11-23-pi-0.85.1-baseline`](../2026-11-23-pi-0.85.1-baseline/summary.md) at clean
`11b9397ee` (Pi CLI 0.85.1); after: clean `b44365353` (Pi CLI 1.6.0; the later
`findLast` → loop change is behavior-identical). native-codex rows are setup records
(no `config.codex`), pi-independent, excluded. Fresh series, none resumed; failure
classes/notes added by hand. [Comparison](comparison.md) (`report --compare` exit 1:
lost passes; it did not refuse the changed lockfile).

| Task | COI before→after | no-COI | native Pi |
|---|---|---|---|
| ms-negative | 3→3 | 2→3 | 3→2 |
| ms-weeks | 2→2 | 1→1 | 3→3 |
| stringify-boxed | 3→2 | 3→3 | 3→3 |
| queue-clear | 0→0 | 0→0 | 3→3 |
| csv-workflow-v5 | 3→1 | 3→2 | 3→2 |
| markdown-notes-v4 | 2→3 | 2→2 | 2→1 |
| **total /18** | **13→11** | **11→11** | **17→14** |

41/54 → 36/54. Classes after: agent 10, rifty-runtime 5, ai-mode-ux 2, provider 1
(before: agent 7, rifty-runtime 6).

- Lost passes: none classed rifty-runtime/rifty-tooling. Two COI losses are setup
  (workspace-import toast timeout before the agent starts, 0 tool calls; backlog
  `playground/workspace-import-success-observation-timeout`). The rest are agent-built
  app defects (judge probes) plus one native provider failure (proxy streams without
  `finish_reason` ×4).
- csv-workflow-v5 dropped in all three Pi lanes (9/9 → 5/9; native CLI too), which points
  away from a rifty-runtime cause. Observed pi 1.6.0 wire change on both rifty and native:
  the prompt role went from `developer` to `system`, because pi now uses `developer` only on
  api.openai.com. Not isolated; no causal claim with n=3.
- queue-clear stays 0/6 in rifty (AsyncLocalStorage across `await`, rifty-runtime,
  pre-existing).
