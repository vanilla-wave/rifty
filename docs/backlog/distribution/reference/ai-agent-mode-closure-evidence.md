# AI agent mode and benchmark: goal closure

Accepted goal: `docs/backlog/epics/ai-agent-mode-and-bench/goal.md` at
f5ff8b8484af6575d5761afd94c75f98cfda2da1. Outcome/scenarios/I1–I8 unchanged.
Tier works; no scope amendment or required deferral. Goal is distinct from the
remaining M12 product UI/subagents/demo work.

| Invariant | Executed representative proof |
|---|---|
| I1: public Workbench host, tools/capabilities | `tests/browser-unit/agent-core.spec.ts`, real packed consumer `tests/integration/fixtures/workbench-vite-consumer/src/agent-proof.ts`; core Final523628b0 |
| I2: integrator tools/instructions/transport, optional key | Same core fixture and actual no-auth provider requests; native Pi oracle; key/transport/fault assertions in core and benchmark; core Final523628b0 |
| I3: partial failure, Stop, continuation | Core same-session write→provider error→continue and Stop→next; `tests/no-coi/no-coi-pi-agent.spec.ts` real Worker replacement/history; no-COI Final1989bdfc |
| I4: limits, cap, trace | Core budget/cap/export cases, UI real Stop/limit/export; all-three benchmark tool/time admission and post-write provider failure; Finals523628b0/0bcf3340/f5ff8b848 |
| I5: lazy +chat, visible terminal/editor/SCM/preview/settings | `tests/e2e/ai-mode.spec.ts`, production lazy bundle proof, real no-auth React edit/build/preview trace; UI Final0bcf3340 and15 live COI benchmark programs |
| I6: no-COI public project, host-owned modes | `tests/no-coi/no-coi-pi-agent.spec.ts`, `no-coi-resident-exit.spec.ts`; composed edit→build→preview→edit, no raw-fs escape; Final1989bdfc and12 packed no-COI live programs |
| I7: six embedding scenarios | Real core/packed/no-COI fixtures cover fixed deps, custom tools/transport, absent capabilities, failed build→repair, provider error after write, Stop→next on representative actual projects; Finals523628b0/1989bdfc |
| I8: complete diagnostic |14 actual task/lane smoke pairs with identical judge evidence;42 model runs, original38/42→retained-artifact recheck42/42, four task-bad rows; model/profile, actual differences, metrics, source, locks, traces and evidence retained; Finalf5ff8b848 |

Review artifacts: `ai-agent-core-final-green.json`, `ai-agent-no-coi-final-green.json`,
`../../playground/reference/ai-mode-chat-final-green.json`, `agent-bench-final-green.json`.
Accepted transitions compose on real React/Node projects, including the actual
COI/no-COI benchmark workflows; separate fixtures do not substitute their transitions.
The final reviewer independently inspected complete goal evidence and native
oracle/captured artifacts; prior unchanged proofs are reused under REV1.

Baseline questions: real React declarations/.bin/tsc/Monaco pass after native
npm tar extraction repair; no-COI Node flags, builtins, pipes and git init/status
work. Vitest2.1.9 is an explicit legacy-esbuild admission ceiling, measured against
a passing native test. Details: `agent-bench-baseline-results.md`.

Final product gate f5ff8b848: pr:check25/25; deterministic benchmark12/12;
seven native controls. Raw outputs: `agent-bench-validation.json.gz`.
Live evidence: `tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol/README.md`.
No required unit/goal residuals. Out-of-goal preview/coexistence remains owned by
`distribution/public-api-ai-agent-preview-question` with its existing pickup trigger.

Independent goal closure PASS at e8748d60cde030635dee820c595f497e21a78ec9:
all I1–I8, empty residuals, docs-only delta and completed-item cleanup verified.
Final+GREEN retains reviewed_sha f5ff8b848 so the accepted contract is read from
that revision; delete-on-done is handled by the normal pass-binding gate.
Closure-tree full pr:check also passed25/25 (unit187.9s/parity60.7s).

Post-closure review fixes (2026-09-13, inline review NOTEs repaired in place):
owned incomplete terminal line discarded (RED `tests/browser-unit/agent-ui-terminal.spec.ts:134`),
shared installed-tarball registry `tests/integration/installed-registry.mjs`, unused
helpers/lint. Independent Final+GREEN PASS on the fixes (`pr-333-final-review-1.json`, f756a8573), on
the first merge with origin/main (`pr-333-final-review-2.json`, cdad87352) and on the
second (`pr-333-final-green.json`, reviewed 43673ab99): browser-unit 22/22, no-COI 5/5,
e2e ai-mode 10/10, pr:check 25/25, packed-consumer 1/1, agent-bench contract 12/12
re-executed on each merged tree.
