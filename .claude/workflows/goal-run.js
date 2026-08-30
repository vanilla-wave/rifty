export const meta = {
  name: 'goal-run',
  description:
    'Drive one ready rifty goal to close: slice loop (PICKUP → Contract+RED → implement → Final+GREEN → RECHART) until the map is empty, then CLOSE; structured stop on any user-owned decision.',
  whenToUse:
    'Explicit whole-ready-goal hand-off in a Claude session. Canon stays in .agents/skills/rifty-goal + docs/process; this script owns only order, gates, bookkeeping. Re-entrant: re-invoke after a stop — done stages skip off disk state. The invoking session is an observer while the run is live: relay statuses/stops in brief, never edit tracked files (a hand edit voids tree-bound checkpoint verdicts); sole exception — resolving a stop with the user via rifty-refine, then re-invoke (decision-workflow.md §Goal runs).',
  phases: [
    { title: 'Preflight', detail: 'goal ready, tree clean, re-chart debt' },
    { title: 'Slices', detail: 'pickup → Contract+RED → implement → Final+GREEN → re-chart, looped' },
    { title: 'Close', detail: 'invariants proof, ledger+fog walk, delete goal dir' },
  ],
}

// args: { goal: '<epics dir slug>', date: 'YYYY-MM-DD', maxSlices? }
// Stop contract: every non-{closed} return names the user-owned decision or valve that blocked.
// Checkpoint rounds have no cap arg on purpose: the valves below are canon
// (fault-classes.md §Review convergence), not a budget an agent may raise.
if (!args?.goal || !args?.date) return { stop: 'args', need: "{ goal: '<slug>', date: 'YYYY-MM-DD' }" }
const { goal, date } = args
const MAX_SLICES = args.maxSlices ?? 8
const DIR = `docs/backlog/epics/${goal}`
const GOAL_SKILL = '.agents/skills/rifty-goal'

const STATE = {
  type: 'object',
  required: ['goalReady', 'treeClean', 'rechartDebt', 'mapEmpty', 'frontierChild', 'pickedChildReady'],
  properties: {
    goalReady: { type: 'boolean' }, // goal.md status:ready
    treeClean: { type: 'boolean' },
    rechartDebt: { type: 'boolean' }, // last landed slice missing its re-chart ledger line
    mapEmpty: { type: 'boolean' }, // map.md ## Items empty
    frontierChild: { type: ['string', 'null'] }, // first open unblocked child in seed order
    pickedChildReady: { type: 'boolean' }, // frontier child already carries ready-verdict:
    notes: { type: 'string' },
  },
}
const PICKUP = {
  type: 'object',
  required: ['done'],
  properties: {
    done: { type: 'boolean' },
    fork: { type: ['string', 'null'] }, // user-observable fork → manual rifty-refine
    band: { type: 'string' },
  },
}
const VERDICT = {
  type: 'object',
  required: ['pass'],
  properties: { pass: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } } },
}

const state = (label) =>
  agent(
    `Read-only. Inspect goal ${DIR} and git in this repo. Report facts per the schema: goal.md is status:ready (goalReady); working tree clean (treeClean); ledger tail shows a landed slice without its 're-chart after <slice>' line (rechartDebt); map.md '## Items' is empty (mapEmpty); first frontier child — open, unblocked by blocked_by, in seed order (frontierChild, null if none); that child already carries a 'ready-verdict:' line (pickedChildReady).`,
    { schema: STATE, label, phase: 'Preflight' },
  )

// One checkpoint = codex run per rifty-review §Checkpoint run; blockers → one batch fix → verify.
// Two valves end the loop instead of grinding (fault-classes.md §Review convergence):
// Contract escalation (2nd consecutive Contract+RED blocker = the contract is wrong) and
// Convergence (count not strictly falling across two rounds = fixes grow the surface).
async function checkpoint(name, child) {
  const counts = []
  let escalated = false
  for (let attempt = 1; ; attempt++) {
    const v = await agent(
      `Run the ${name} checkpoint for goal ${goal} per .agents/skills/rifty-review/SKILL.md §Checkpoint run — you are the runner, codex is the reviewer; follow the skill verbatim (find pass, tail pass, adjudication, blockers.mjs). Append the verdict line to the unit doc's ## Decisions. Return pass=true only on exit 0; otherwise list surviving HOLDS blockers verbatim.`,
      { schema: VERDICT, label: `${child}:${name}#${attempt}`, phase: 'Slices' },
    )
    if (v?.pass) return { pass: true }
    const blockers = v?.blockers ?? []
    if (!blockers.length) return { pass: false, stop: `${name} returned no pass and no blockers` }
    counts.push(blockers.length)
    if (counts.length >= 3 && counts.at(-1) >= counts.at(-2) && counts.at(-2) >= counts.at(-3)) {
      return {
        pass: false,
        blockers,
        stop: `${name} not converging (blockers ${counts.join('→')}) — the fixes grow the review surface faster than they close it; round ${attempt + 1} will not converge`,
      }
    }
    if (name === 'Contract+RED' && attempt >= 2) {
      if (escalated) {
        return {
          pass: false,
          blockers,
          stop: '2nd Contract+RED escalation in one lineage — the contract is not reviewable; only the user re-scopes it (rifty-refine)',
        }
      }
      escalated = true
      await agent(
        `Goal ${goal}, unit ${child}: 2nd consecutive Contract+RED blocker → §Contract escalation. The contract is wrong, not the tests. Split or re-refine it IN PLACE per docs/process/fault-classes.md and decision-workflow.md §Backlog readiness 5: record the fork plus the pre-demotion Acceptance/Parity verbatim, carry the recorded verdict lines into the successor, name the predecessor. Do NOT answer the blockers with more test surface:\n${blockers.map((b) => `- ${b}`).join('\n')}`,
        { label: `${child}:escalate#${attempt}`, phase: 'Slices' },
      )
      continue
    }
    await agent(
      `Goal ${goal}, unit ${child}: batch re-cut IN PLACE (same branch, lineage carries — never a fresh start) fixing ALL surviving ${name} blockers in one batch, then commit:\n${blockers.map((b) => `- ${b}`).join('\n')}\nNever weaken a ready contract silently (demotion records the fork), never edit a test to pass.`,
      { label: `${child}:fix#${attempt}`, phase: 'Slices' },
    )
  }
}

const rechart = (after) =>
  agent(
    `Run RECHART per ${GOAL_SKILL}/RECHART.md for goal ${goal}, date ${date}${after ? ` after slice ${after}` : ''}: ledger one-liners, graduate phrasable fog into draft children (rifty-to-backlog shape incl. '## Challenge' via a fresh critic subagent — docs/backlog/README.md §Challenge), invalidate/reorder, append the 're-chart after <slice>' line. Commit.`,
    { label: `rechart${after ? `:${after}` : ''}`, phase: 'Slices' },
  )

phase('Preflight')
let st = await state('state:initial')
if (!st) return { stop: 'state agent failed' }
if (!st.goalReady) return { stop: 'goal not ready — FIT first (outside this workflow)' }
if (!st.treeClean) return { stop: 'dirty tree — commit or drop local changes first' }

phase('Slices')
let landed = 0
while (!st.mapEmpty) {
  if (landed >= MAX_SLICES) return { stop: `slice cap ${MAX_SLICES} reached — map still has items`, landed }
  if (st.rechartDebt) {
    await rechart(null)
    st = await state(`state:post-debt`)
    if (!st) return { stop: 'state agent failed' }
    continue
  }
  const child = st.frontierChild
  if (!child) return { stop: 'map non-empty but no frontier child — everything blocked; re-cut needed', notes: st.notes }

  if (!st.pickedChildReady) {
    const p = await agent(
      `Run PICKUP per ${GOAL_SKILL}/PICKUP.md for goal ${goal}, child ${child}, date ${date}: compile draft→ready per decision-workflow §Backlog readiness, declare the band ledger row, commit. A remaining user-observable fork: return it in 'fork' and change nothing further — never interview. Do NOT run the checkpoint, do NOT implement.`,
      { schema: PICKUP, label: `pickup:${child}`, phase: 'Slices' },
    )
    if (!p?.done) return { stop: p?.fork ? 'user fork — manual rifty-refine' : 'pickup failed', child, fork: p?.fork ?? null }
    const cr = await checkpoint('Contract+RED', child)
    if (!cr.pass) return { stop: cr.stop, child, blockers: cr.blockers }
  }

  await agent(
    `Implement the ready unit ${child} of goal ${goal} on this branch, within its declared ledger band: expected RED first, then GREEN; classify every discovery per ${GOAL_SKILL}/SKILL.md run rules (required → reverse-linked draft child, outside → rifty-to-backlog; new drafts carry '## Challenge' per docs/backlog/README.md §Challenge); append ledger lines for decisions/observations. Commit; leave the tree clean; pnpm pr:check must pass.`,
    { label: `implement:${child}`, phase: 'Slices' },
  )
  const fg = await checkpoint('Final+GREEN', child)
  if (!fg.pass) return { stop: fg.stop, child, blockers: fg.blockers }
  await rechart(child)
  landed++
  log(`slice ${child} landed (${landed})`)
  st = await state(`state:after:${child}`)
  if (!st) return { stop: 'state agent failed' }
}

phase('Close')
const close = await agent(
  `Run CLOSE per ${GOAL_SKILL}/CLOSE.md for goal ${goal}, date ${date}: verify preconditions; prove every '## Invariants' statement end-to-end citing artifacts (a grep or one green slice closes nothing); walk EVERY ledger line and EVERY map.md fog line to a verified carrier, a minted carrier, or an explicit 'dropped: <reason>'; direction verdicts for before/after numbers; declined-concepts rows; then delete the goal dir whole + CHANGELOG line; pnpm backlog:check must pass. Return closed=false with the unresolved lines if ANY line or invariant cannot be closed — never force it.`,
  {
    schema: {
      type: 'object',
      required: ['closed'],
      properties: {
        closed: { type: 'boolean' },
        unresolved: { type: 'array', items: { type: 'string' } },
        dispositions: { type: 'string' }, // counts: carriers / minted / dropped
      },
    },
    label: 'close',
    phase: 'Close',
  },
)
if (!close?.closed) return { stop: 'close blocked', unresolved: close?.unresolved ?? ['close agent failed'], landed }
return { closed: true, landed, dispositions: close.dispositions, next: 'goal PR ready for user merge (default: the one goal PR; split allowed)' }
