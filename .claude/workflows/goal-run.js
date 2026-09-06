export const meta = {
  name: 'goal-run',
  description:
    'Drive one ready rifty goal to close: unit loop (PICKUP incl. Contract+RED → IMPLEMENT → Final+GREEN or ordinary review → RECHART) until the map is empty, then CLOSE; a stop only on the closed STOP-1 list.',
  whenToUse:
    'Explicit whole-ready-goal hand-off in a Claude session. Canon: docs/process/README.md (stages, rules by id); every rule is read from its stage doc by the agent that runs the stage — this script only orders stages and relays their exits. Re-entrant: re-invoke after a stop or a harness report; state is read from disk. The invoking session relays statuses and may resolve a STOP-1a with the user via rifty-refine, then re-invoke.',
  phases: [
    { title: 'Preflight', detail: 'goal ready, tree clean' },
    { title: 'Slices', detail: 'pickup (+Contract+RED) → implement → Final+GREEN / ordinary review → re-chart, looped' },
    { title: 'Close', detail: 'invariants proof, ledger+fog walk, delete goal dir' },
  ],
}

// args: { goal: '<epics dir slug>', date: 'YYYY-MM-DD' }
// Every stage agent returns the same exit shape (STAGE). Returns of this script: {closed} · a STOP-1
// item (kind, question, report — docs/process/rules/stops.md STOP-6; the ledger got its stop: line)
// · a report needing no answer (kind 'frontier-empty' | 'harness') · a precondition failure.
if (!args?.goal || !args?.date) return { stop: 'args', need: "{ goal: '<slug>', date: 'YYYY-MM-DD' }" }
const { goal, date } = args
const DIR = `docs/backlog/epics/${goal}`
const STAGES = 'docs/process/stages'

const STATE = {
  type: 'object',
  required: ['goalReady', 'treeClean', 'mapEmpty', 'frontierChild', 'childStage', 'userFog'],
  properties: {
    goalReady: { type: 'boolean' }, // goal.md status:ready
    treeClean: { type: 'boolean' },
    mapEmpty: { type: 'boolean' }, // map.md ## Items empty
    frontierChild: { type: ['string', 'null'] }, // first ## Items row whose unit is open and unblocked (artifacts/map.md)
    // by status first: draft → 'draft' (journal lines are history, review.md REV-8); ready → 'ready-unverified' (no line) | 'certified' (ready-verdict:) | 'ordinary' (review: ordinary)
    childStage: { type: ['string', 'null'] },
    userFog: { type: ['string', 'null'] }, // first '## Open questions' line tagged owner: user, verbatim
    notes: { type: 'string' },
  },
}
// One exit shape for every stage (the stage doc names which exits it has).
const STAGE = {
  type: 'object',
  required: ['outcome'],
  properties: {
    outcome: { type: 'string', enum: ['done', 'pass', 'left-path', 'stop', 'harness'] },
    kind: { type: ['string', 'null'] }, // stop: STOP-1a | STOP-1b | STOP-1e
    question: { type: ['string', 'null'] }, // stop: the one question
    report: { type: ['string', 'null'] }, // STOP-6 screen (stop, incl. the default if the user stays silent); what resisted (left-path); what broke (harness)
    unit: { type: ['string', 'null'] }, // the unit after a split, else null
    sha: { type: ['string', 'null'] }, // pass: the reviewed commit
    goalResiduals: { type: 'array', items: { type: 'string' } }, // pass: goal residuals from the verdict (RECHART reads them)
  },
}

const state = (label) =>
  agent(
    `Read-only. Inspect goal ${DIR} and git. Report per the schema: goal.md status:ready (goalReady); working tree clean (treeClean); map.md '## Items' empty (mapEmpty); first '## Items' row whose unit is open and unblocked by blocked_by, in order (frontierChild; a unit not listed there is not on the path); that unit's stage — status draft → 'draft' whatever lines its journal holds; status ready → 'ready-unverified' (no 'ready-verdict:'/'review:' line), 'certified' (a 'ready-verdict:' line AND its committed docs/backlog/<area>/reference/<slug>-contract-red.json — it wins when a 'review: ordinary' line is also present; the line without the file is 'ready-unverified'), 'ordinary' (only a 'review: ordinary' line) (childStage); the first map.md '## Open questions' line tagged 'owner: user', verbatim (userFog).`,
    { schema: STATE, label, phase: 'Preflight' },
  )

const run = (name, doc, unit, extra = '') =>
  agent(
    `Run ${name} per ${doc} for goal ${goal}${unit ? `, unit ${unit}` : ''}, date ${date}.${extra ? ` ${extra}` : ''} Follow the doc; it names every exit. Report the exit per the schema: 'done' (PICKUP, IMPLEMENT, RECHART, CLOSE); 'pass' (a checkpoint or the ordinary review — sha = the reviewed commit, goalResiduals from the verdict); 'left-path' (the unit left the path — report = what resisted, ready for the RECHART fog line); 'stop' (kind STOP-1a|STOP-1b|STOP-1e, question, report = the STOP-6 screen including the default if the user stays silent); 'harness' (report). After a split, unit = the successor path.`,
    { schema: STAGE, label: unit ? `${name}:${unit}` : name, phase: name === 'CLOSE' ? 'Close' : 'Slices' },
  )

const note = (line) =>
  agent(`Goal ${goal}: append '- ${date} — ${line}' to ${DIR}/ledger.md, commit (short one-line subject), push. Nothing else.`, {
    label: 'ledger',
    phase: 'Slices',
  })

// A stop writes its ledger line (STOP-6) and ends the run with the question.
const stop = async (r, unit) => {
  await note(`${unit ? `${unit} ` : ''}stop: ${r.kind} — ${r.question}`)
  return { pass: false, kind: r.kind, child: unit, stop: r.question, report: r.report }
}

// RECHART after a landed slice (its PASS line) or a unit leaving the path (its fog line).
const rechart = (unit, r) =>
  run(
    'RECHART',
    `${STAGES}/rechart.md`,
    unit,
    r.outcome === 'left-path'
      ? `The unit LEFT THE PATH (stops.md STOP-4 3): ${r.report}.`
      : `The slice landed: PASS @ ${r.sha} (final-green or ordinary per the unit's review: line)${r.goalResiduals?.length ? `; goal residuals from the verdict: ${r.goalResiduals.join(' | ')}` : ''}.`,
  )

// Route one stage exit; returns null to continue the loop, or the script's return value.
async function exit(r, unit) {
  if (!r?.outcome) return { stop: `${unit ?? goal}: stage agent returned no exit`, kind: 'precondition' }
  if (r.outcome === 'stop') return stop(r, unit)
  if (r.outcome === 'harness') {
    await note(`${unit ?? goal} run ended: ${r.report}`)
    return { pass: false, kind: 'harness', child: unit, stop: r.report }
  }
  if (r.outcome === 'left-path') {
    const rc = await rechart(unit, r)
    if (rc?.outcome === 'stop') return stop(rc, unit)
    if (rc?.outcome !== 'done') return { stop: `${unit}: RECHART did not complete — ${rc?.report ?? 'no exit'}`, kind: 'harness', child: unit }
    return null
  }
  return null
}

phase('Preflight')
let st = await state('state:initial')
if (!st) return { stop: 'state agent failed', kind: 'precondition' }
if (!st.goalReady) return { stop: 'goal not ready — FIT first (outside this workflow)', kind: 'precondition' }
if (!st.treeClean) return { stop: 'dirty tree — commit or drop local changes first', kind: 'precondition' }

phase('Slices')
let landed = 0
while (!st.mapEmpty) {
  let child = st.frontierChild
  if (!child) {
    // A frontier empty behind an owner: user question is where that question is asked (STOP-4 3).
    if (st.userFog) return stop({ kind: 'STOP-1a', question: `frontier empty behind an open question — manual rifty-refine: ${st.userFog}`, report: st.notes }, null)
    await note(`run ended: map non-empty, no frontier child — every remaining row is blocked`)
    return { pass: false, kind: 'frontier-empty', landed, stop: 'map non-empty, no frontier child; a report, not a question', notes: st.notes }
  }
  let stage = st.childStage
  if (stage === 'draft' || stage === 'ready-unverified') {
    const p = await run('PICKUP', `${STAGES}/pickup.md`, child) // compiles; runs Contract+RED for a checkpoints unit (pickup.md 5)
    const x = await exit(p, child)
    if (x) return x
    if (p.outcome === 'left-path') {
      st = await state(`state:left:${child}`)
      if (!st) return { stop: 'state agent failed', kind: 'precondition' }
      continue
    }
    child = p.unit ?? child
    st = await state(`state:picked:${child}`)
    if (!st) return { stop: 'state agent failed', kind: 'precondition' }
    stage = st.childStage
    // PICKUP ends certified (verdict + artifact) or ordinary — anything else never reaches IMPLEMENT.
    if (stage !== 'certified' && stage !== 'ordinary') {
      await note(`${child} run ended: PICKUP returned done but the unit is ${stage ?? 'unknown'} — no Contract+RED verdict artifact and no review: ordinary`)
      return { pass: false, kind: 'harness', child, stop: `PICKUP left ${child} ${stage ?? 'unknown'}` }
    }
  }
  const impl = await run('IMPLEMENT', `${STAGES}/implement.md`, child)
  const xi = await exit(impl, child)
  if (xi) return xi
  if (impl.outcome === 'left-path') {
    st = await state(`state:left:${child}`)
    if (!st) return { stop: 'state agent failed', kind: 'precondition' }
    continue
  }
  const fin =
    stage === 'ordinary'
      ? await run('the ordinary review', `${STAGES}/checkpoint-run.md §Ordinary review`, child)
      : await run('Final+GREEN', `${STAGES}/final-green.md`, child)
  const xf = await exit(fin, child)
  if (xf) return xf
  if (fin.outcome === 'left-path') {
    st = await state(`state:left:${child}`)
    if (!st) return { stop: 'state agent failed', kind: 'precondition' }
    continue
  }
  child = fin.unit ?? child
  const rc = await rechart(child, fin)
  if (rc?.outcome === 'stop') return stop(rc, child)
  if (rc?.outcome !== 'done') return { stop: `${child}: RECHART did not complete — ${rc?.report ?? 'no exit'}`, kind: 'harness', child }
  landed++
  log(`slice ${child} landed (${landed})`)
  st = await state(`state:after:${child}`)
  if (!st) return { stop: 'state agent failed', kind: 'precondition' }
}

phase('Close')
const close = await run('CLOSE', `${STAGES}/close.md`, null, 'Never force a line or an invariant: an open owner: user fog line or an unreachable invariant is a stop (STOP-1a / STOP-1e).')
const xc = await exit(close, null)
if (xc) return xc
if (close.outcome !== 'done') return { stop: 'close blocked', kind: 'precondition', report: close.report, landed }
return { closed: true, landed, next: 'merge the goal PR (PR-3, DEC-3: pre-authorized once given; one goal PR by default, split allowed)' }
