export const meta = {
  name: 'goal-run',
  description: 'Drive a goal in one session; independent review at proof boundaries.',
  whenToUse: 'Explicit whole-goal hand-off; re-entry reads obligations and review evidence.',
  phases: [{ title: 'Goal', detail: 'prepare → implement → review → rechart → close' }],
}

if (!args?.goal) return { stop: 'args', need: "{ goal: '<slug>' }" }
phase('Goal')
return await agent(
  `Drive goal docs/backlog/epics/${args.goal} through completion using rifty-goal and docs/process/README.md. You are the one driver for all stages: keep state, records, reports and routine git operations in this session. Fresh contexts are required for independent premise/contract/result review and disputed blockers (DEC-5, REV-11). Preparation follows missing evidence (RDY-8); every final review uses the same JSON and validator. Continue independent work on a technical impasse; ask only for a real user choice (STOP-1). Amend accepted scope only on the user's recorded decision (RDY-6). Resume from actual obligations and evidence, not a stale status line. Run required proofs, update the existing goal PR, report result, verification and residuals.`,
  { label: `goal:${args.goal}`, phase: 'Goal' },
)
