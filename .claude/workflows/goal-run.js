export const meta = {
  name: 'goal-run',
  description:
    'Drive one ready rifty goal to close: slice loop (PICKUP → Contract+RED → implement → Final+GREEN → RECHART) until the map is empty, then CLOSE; structured stop only on the closed STOP-1 list.',
  whenToUse:
    'Explicit whole-ready-goal hand-off in a Claude session. Canon: docs/process/README.md (stages, rules by id); this script owns only order, budget accounting, bookkeeping. Re-entrant: re-invoke after a stop — done stages skip off disk state. The invoking session is an observer while the run is live: relay statuses/stops in brief, never edit tracked files (a hand edit voids tree-bound verdicts); sole exception — resolving a STOP-1a fork with the user via rifty-refine, then re-invoke.',
  phases: [
    { title: 'Preflight', detail: 'goal ready, tree clean, re-chart debt' },
    { title: 'Slices', detail: 'pickup → Contract+RED → implement → Final+GREEN → re-chart, looped' },
    { title: 'Close', detail: 'invariants proof, ledger+fog walk, delete goal dir' },
  ],
}

// args: { goal: '<epics dir slug>', date: 'YYYY-MM-DD', maxSlices? }
// Stop contract: every non-{closed} return is either a STOP-1 item (docs/process/rules/stops.md,
// kind 'STOP-1a'..'STOP-1e', with the STOP-6 report fields and a ledger `stop:` line) or a
// precondition failure (kind 'precondition' / 'invalid-verdict'). Budgets come from the unit
// (RDY-9), never from args.
if (!args?.goal || !args?.date) return { stop: 'args', need: "{ goal: '<slug>', date: 'YYYY-MM-DD' }" }
const { goal, date } = args
const MAX_SLICES = args.maxSlices ?? 8
const DIR = `docs/backlog/epics/${goal}`
const STAGES = 'docs/process/stages'
const RULES = 'docs/process/rules'
const DEFAULT_ROUNDS = { 'Contract+RED': 1, 'Final+GREEN': 2 } // RDY-9 defaults

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
    childOrdinaryReview: { type: 'boolean' }, // child's `review: ordinary` line — no checkpoints
    childRounds: { type: ['number', 'null'] }, // child's `review: checkpoints rounds:<n>` — Final+GREEN budget
    notes: { type: 'string' },
  },
}
const PICKUP = {
  type: 'object',
  required: ['done'],
  properties: {
    done: { type: 'boolean' },
    fork: { type: ['string', 'null'] }, // STOP-1a: user-observable fork → manual rifty-refine
    band: { type: 'string' },
    rounds: { type: ['number', 'null'] }, // declared Final+GREEN rounds (RDY-9)
    ordinaryReview: { type: 'boolean' }, // unit outside REV scope → no checkpoints (RDY-8)
  },
}
const VERDICT = {
  type: 'object',
  required: ['pass'],
  properties: {
    pass: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    premise: { type: ['string', 'null'] }, // REV-6 premise concern raised by the reviewer → STOP-1b
  },
}
const RECUT = {
  type: 'object',
  required: ['done'],
  properties: {
    done: { type: 'boolean' },
    fork: { type: ['string', 'null'] }, // STOP-1a: the re-cut would drop/weaken an I#/scenario row
    unit: { type: ['string', 'null'] }, // unit to verify next: the same child, or its split successor
  },
}

const state = (label) =>
  agent(
    `Read-only. Inspect goal ${DIR} and git in this repo. Report facts per the schema: goal.md is status:ready (goalReady); working tree clean (treeClean); ledger tail shows a landed slice without its 're-chart after <slice>' line (rechartDebt); map.md '## Items' is empty (mapEmpty); first frontier child — open, unblocked by blocked_by, in seed order (frontierChild, null if none); that child already carries a 'ready-verdict:' line (pickedChildReady); that child's doc says 'review: ordinary' (childOrdinaryReview — false when absent or 'checkpoints'); the number after 'rounds:' in its 'review: checkpoints rounds:<n>' line (childRounds, null when absent).`,
    { schema: STATE, label, phase: 'Preflight' },
  )

// Every STOP-1 return first writes the ledger `stop:` line (artifacts/ledger.md, STOP-6).
const stop = async (kind, child, question, extra = {}) => {
  await agent(
    `Goal ${goal}: append the ledger line '- ${date} — ${child ?? goal} stop: ${kind} — ${question}' to ${DIR}/ledger.md, commit (short one-line subject), push. Nothing else.`,
    { label: `stop:${kind}`, phase: 'Slices' },
  )
  return { pass: false, kind, child, stop: question, ...extra }
}

// One checkpoint per ${STAGES}/checkpoint-run.md: find (+tail) → adjudicate → record → fix → verify.
// Rounds are the unit's declared budget (STOP-2); a stalled blocker skips the remaining rounds
// (STOP-3); a 2nd consecutive Contract+RED blocker is contract escalation (STOP-5); all three
// route to ONE agent-owned re-cut against the destination (STOP-4); blockers surviving that
// re-cut stop to the user (STOP-1c). A premise concern stops at once (STOP-1b, REV-6).
async function checkpoint(name, child, rounds) {
  let current = child // the unit under verification — a STOP-4 split moves it to the successor
  let previous = new Set()
  let recut = false
  const history = []
  for (let attempt = 1; ; attempt++) {
    const v = await agent(
      attempt === 1
        ? `Run the ${name} checkpoint for goal ${goal}, unit ${current}, per ${STAGES}/checkpoint-run.md (you are the runner, codex is the reviewer: find pass, tail pass only when band ≥ 5, adjudication, blockers.mjs). Record the verdict line in the unit doc's ## Decisions BEFORE anything else (REV-8). Return pass=true only on exit 0; otherwise list surviving HOLDS blockers verbatim as '<authority> — <summary>'. A premise concern in the verdict (REV-6) goes verbatim into 'premise'.`
        : `Run the ${name} VERIFY pass for goal ${goal}, unit ${current}, per ${STAGES}/checkpoint-run.md step 7 (same reviewer command, prior verdicts attached as settled; adjudication; blockers.mjs). Record the verdict line (REV-8). Return pass=true only on exit 0; otherwise list surviving HOLDS blockers verbatim as '<authority> — <summary>'. A premise concern (REV-6) goes verbatim into 'premise'.`,
      { schema: VERDICT, label: `${current}:${name}#${attempt}`, phase: 'Slices' },
    )
    if (v?.premise) return stop('STOP-1b', current, `premise concern at ${name}: ${v.premise}`)
    if (v?.pass) return { pass: true, unit: current }
    const blockers = v?.blockers ?? []
    if (!blockers.length) return { pass: false, kind: 'invalid-verdict', child: current, stop: `${name} returned no pass and no blockers` }
    history.push(blockers.length)
    const spent = attempt - 1 // rounds already spent = fix batches so far
    const escalation = name === 'Contract+RED' && attempt >= 2
    const stalled = blockers.some((b) => previous.has(b))
    const exhausted = spent >= rounds
    if (escalation || stalled || exhausted) {
      const trigger = escalation ? 'STOP-5 contract escalation' : stalled ? 'STOP-3 stall' : 'STOP-2 budget exhausted'
      if (recut) {
        return stop(
          'STOP-1c',
          current,
          `${name}: blockers survive the agent-owned re-cut (${trigger}; blocker counts ${history.join('→')}, rounds ${rounds}). STOP-6: surviving blockers with authority — ${blockers.join(' | ')}; ONE question with a default: re-scope the traced obligation via rifty-refine, raise the budget, or drop the unit?`,
          { blockers },
        )
      }
      recut = true
      const r = await agent(
        `Goal ${goal}, unit ${current}: ${trigger} at ${name} — perform the ONE agent-owned re-cut per ${RULES}/stops.md STOP-4: trim the unit to its traced obligations, demote untraced rows to notes or backlog (rifty-to-backlog), turn exactness the trace target does not state into concerns, split by trace if over RDY-4 limits (successor inherits verdict lines, RDY-9), record 're-cut: ${date} — <what> — trace: none' in ## Decisions and a ledger line, then fix the blockers that remain genuine in one batch and commit. Return unit = the path to verify next (this unit, or its split successor). A blocker that requires dropping or weakening a row traced to I# or scenario is NOT yours: return it in 'fork' (STOP-1a) and change nothing else. Do NOT answer blockers with more test surface. Blockers:\n${blockers.map((b) => `- ${b}`).join('\n')}`,
        { schema: RECUT, label: `${current}:recut#${attempt}`, phase: 'Slices' },
      )
      if (r?.fork) return stop('STOP-1a', current, `re-cut needs an observable-scope decision — manual rifty-refine: ${r.fork}`, { blockers })
      if (!r?.done) return { pass: false, kind: 'precondition', child: current, stop: 're-cut agent failed' }
      current = r.unit ?? current
      previous = new Set(blockers)
      continue
    }
    await agent(
      `Goal ${goal}, unit ${current}: batch re-cut IN PLACE (same branch, lineage carries — never a fresh start) fixing ALL surviving ${name} blockers in one batch, then commit (round ${spent + 1} of ${rounds}):\n${blockers.map((b) => `- ${b}`).join('\n')}\nNever weaken a ready contract silently (RDY-5: record 're-cut:'; a user-traced row change is a fork), never edit a test to pass. Concerns are advisory — do not spend this round on them.`,
      { label: `${current}:fix#${attempt}`, phase: 'Slices' },
    )
    previous = new Set(blockers)
  }
}

const rechart = (after) =>
  agent(
    `Run RECHART per ${STAGES}/rechart.md for goal ${goal}, date ${date}${after ? ` after slice ${after}` : ''}: ledger one-liners, graduate phrasable fog into draft children (rifty-to-backlog shape incl. '## Challenge' via a fresh critic subagent), invalidate/reorder, append the 're-chart after <slice>' line. Commit.`,
    { label: `rechart${after ? `:${after}` : ''}`, phase: 'Slices' },
  )

phase('Preflight')
let st = await state('state:initial')
if (!st) return { stop: 'state agent failed' }
if (!st.goalReady) return { stop: 'goal not ready — FIT first (outside this workflow)', kind: 'precondition' }
if (!st.treeClean) return { stop: 'dirty tree — commit or drop local changes first', kind: 'precondition' }

phase('Slices')
let landed = 0
let unblocked = false
while (!st.mapEmpty) {
  if (landed >= MAX_SLICES) return stop('STOP-1d', null, `slice cap ${MAX_SLICES} reached — map still has items; continue the run?`, { landed })
  if (st.rechartDebt) {
    await rechart(null)
    st = await state(`state:post-debt`)
    if (!st) return { stop: 'state agent failed', kind: 'precondition' }
    continue
  }
  let child = st.frontierChild
  if (!child) {
    // Everything blocked_by-blocked: re-cutting the map is the agent's (RDY-5) — one RECHART, then re-state.
    if (unblocked) return { stop: 'map non-empty but no frontier child after re-chart', kind: 'precondition', notes: st.notes }
    unblocked = true
    await rechart(null)
    st = await state('state:post-unblock')
    if (!st) return { stop: 'state agent failed', kind: 'precondition' }
    continue
  }

  // Membership + budget are per unit, decided at pickup (RDY-8, RDY-9).
  let ordinary = st.childOrdinaryReview === true
  let rounds = st.childRounds ?? DEFAULT_ROUNDS['Final+GREEN']
  if (!st.pickedChildReady) {
    const p = await agent(
      `Run PICKUP per ${STAGES}/pickup.md for goal ${goal}, child ${child}, date ${date}: compile draft→ready (RDY-2), trace every Acceptance/Parity/Fault row and enforce size (RDY-3, RDY-4 — split now if over), decide membership and rounds (RDY-8, RDY-9: 'review: checkpoints rounds:<n>' or 'review: ordinary' in the unit doc), append the ledger band+rounds row, commit. Return ordinaryReview=true for docs/CI/process/tooling/harness units and rounds as declared. A remaining user-observable fork (STOP-1a): return it in 'fork' and change nothing further — never interview. Do NOT run the checkpoint, do NOT implement.`,
      { schema: PICKUP, label: `pickup:${child}`, phase: 'Slices' },
    )
    if (p?.fork) return stop('STOP-1a', child, `pickup found an observable-scope fork — manual rifty-refine: ${p.fork}`)
    if (!p?.done) return { stop: 'pickup failed', kind: 'precondition', child }
    ordinary = p.ordinaryReview === true
    rounds = p.rounds ?? rounds
    if (!ordinary) {
      const cr = await checkpoint('Contract+RED', child, DEFAULT_ROUNDS['Contract+RED'])
      if (!cr.pass) return cr
      child = cr.unit ?? child
    }
  }

  await agent(
    `Implement the ready unit ${child} of goal ${goal} per ${STAGES}/implement.md: expected RED first, then GREEN within the declared band; classify every discovery (required → reverse-linked draft child with '## Challenge'; outside → rifty-to-backlog); ledger lines for decisions; pnpm pr:check green; commit; tree clean; draft PR body updated.`,
    { label: `implement:${child}`, phase: 'Slices' },
  )
  if (ordinary) {
    const r = await agent(
      `Goal ${goal}, unit ${child} is 'review: ordinary' (RDY-8): run ONE rifty-review pass on this tree per ${RULES}/review.md, fix every blocker in place, then re-run pnpm pr:check. No checkpoint, no lineage. Return pass=true when the gate is green and no blocker is left.`,
      { schema: VERDICT, label: `${child}:ordinary-review`, phase: 'Slices' },
    )
    if (!r?.pass) return { stop: `ordinary review left blockers on ${child}`, kind: 'precondition', child, blockers: r?.blockers }
  } else {
    const fg = await checkpoint('Final+GREEN', child, rounds)
    if (!fg.pass) return fg
    child = fg.unit ?? child
  }
  await rechart(child)
  landed++
  log(`slice ${child} landed (${landed})`)
  st = await state(`state:after:${child}`)
  if (!st) return { stop: 'state agent failed', kind: 'precondition' }
}

phase('Close')
const close = await agent(
  `Run CLOSE per ${STAGES}/close.md for goal ${goal}, date ${date}: verify preconditions; prove every '## Invariants' statement end-to-end citing artifacts (a grep or one green slice closes nothing); walk EVERY ledger line and EVERY map.md fog line to a verified carrier, a minted carrier, or an explicit 'dropped: <reason>'; direction verdicts for before/after numbers; declined-concepts rows; then delete the goal dir whole + CHANGELOG line; pnpm backlog:check must pass. Return closed=false with the unresolved lines if ANY line or invariant cannot be closed — never force it.`,
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
if (!close?.closed) return { stop: 'close blocked', kind: 'precondition', unresolved: close?.unresolved ?? ['close agent failed'], landed }
return { closed: true, landed, dispositions: close.dispositions, next: 'goal PR ready for user merge (default: the one goal PR; split allowed)' }
