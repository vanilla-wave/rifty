export const meta = {
  name: 'goal-run',
  description: 'Drive one ready rifty goal to CLOSE: per unit PICKUP → Contract+RED → IMPLEMENT → Final+GREEN → RECHART, then CLOSE.',
  whenToUse:
    'Claude Code whole-goal hand-off (rifty-goal). args: { goal: "<epics slug>" } or the bare slug; optional maxPasses (verify passes per checkpoint, default 3 — the STOP-3/4 valve, raised only on the user\'s decision). Script = sequencer: no file access, one read-only state leaf, one fresh leaf per stage, a fresh reviewer/critic per checkpoint (REV-11, DEC-5). Returns {closed} or {stop, report}; the invoking session relays and re-invokes after an answer. Canon: docs/process/README.md §Route.',
  phases: [
    { title: 'Preflight', detail: 'goal ready, tree clean' },
    { title: 'Units', detail: 'pickup → contract+red → implement → final+green → rechart, looped' },
    { title: 'Close', detail: 'end-to-end review, cleanup, merge per PR-6' },
  ],
}

const goal = typeof args === 'string' ? args.trim() : args?.goal
if (!goal) return { stop: 'args', report: "need { goal: '<epics slug>' } or the bare slug" }
const MAX_PASSES = (typeof args === 'object' && args?.maxPasses) || 3
const MAX_UNITS = 24 // runaway guard, never a scope
const DIR = `docs/backlog/epics/${goal}`
const CANON = 'docs/process/README.md'
const short = (p) => (p ?? goal).replace(/\.md$/, '').split('/').pop()

const STATE = {
  type: 'object',
  required: ['goalReady', 'treeClean', 'mapEmpty', 'hasCarrier', 'unit', 'unitCertified', 'base', 'branchBase', 'notes'],
  properties: {
    goalReady: { type: 'boolean' }, // goal.md status: ready
    treeClean: { type: 'boolean' }, // git status --porcelain empty
    mapEmpty: { type: 'boolean' }, // map.md '## Items' has no rows
    hasCarrier: { type: 'boolean' }, // the User scenario exists as a committed e2e/parity case (FIT 5 / RECHART 2)
    unit: { type: ['string', 'null'] }, // contract path of the first '## Items' row not blocked by an open dependency
    unitCertified: { type: 'boolean' }, // that contract carries a 'ready-verdict:' line
    base: { type: 'string' }, // last ledger 're-chart after … PASS @ <sha>', else branchBase
    branchBase: { type: 'string' }, // git merge-base HEAD origin/main
    notes: { type: 'string' },
  },
}
// One exit shape for every stage leaf.
const EXIT = {
  type: 'object',
  required: ['outcome', 'report'],
  properties: {
    outcome: { type: 'string', enum: ['done', 'left-path', 'harness'] },
    report: { type: 'string' }, // one screen: what happened / what resisted (left-path) / what broke (harness)
    needsContractRed: { type: 'boolean' }, // PICKUP: RDY-8 requires a Contract+RED checkpoint
    unit: { type: ['string', 'null'] }, // contract path after a compile/split, else null
    disputed: { type: 'array', items: { type: 'string' } }, // reception: blocker summaries sent to the critic
  },
}
const REVIEW = {
  type: 'object',
  required: ['pass', 'verdictPath', 'exitCode', 'blockers'],
  properties: {
    pass: { type: 'boolean' }, // blockers.mjs exit 0
    verdictPath: { type: 'string' },
    exitCode: { type: 'integer' },
    blockers: {
      type: 'array',
      items: { type: 'object', required: ['authority', 'summary'], properties: { authority: { type: 'string' }, summary: { type: 'string' } } },
    },
  },
}

const LEAF =
  'You are one leaf of the goal-run workflow: the script sequences the stages and spawns the independent reviewer and critic itself (REV-11, DEC-5) — never spawn agents, never run a checkpoint review yourself; everything else the stage names happens here: state reads, records (contract/ledger lines), commits, push, the goal\'s draft PR (PR-3). Read state from disk (PR body, ledger tail, contract), not from memory. A STOP-1 question is parked on the map and the run continues.'

const state = (label, phase = 'Units') =>
  agent(
    `Read-only state read for goal ${DIR}: no edits, no commits. Report per schema. goalReady: goal.md status: ready. treeClean: git status --porcelain empty. mapEmpty: map.md '## Items' has no rows. hasCarrier: the goal's User scenario exists as a committed executable e2e/parity case (the acceptance carrier, ${CANON} §FIT 5), named by a map row or a ledger line. unit: contract path (docs/backlog/<area>/<slug>.md) of the first '## Items' row whose dependencies are landed, in map order; null when none. unitCertified: that contract has a 'ready-verdict:' line. base: the sha in the last ledger 're-chart after … PASS @ <sha>' line, else branchBase. branchBase: git merge-base HEAD origin/main. notes: anything the sequencer should know (blocked rows, open owner: user lines).`,
    { schema: STATE, label, phase },
  )

const run = (stage, unit, extra = '', phase = 'Units') =>
  agent(
    `Run ${stage} per ${CANON} §${stage} for goal ${DIR}${unit ? `, unit ${unit}` : ''}.${extra ? ` ${extra}` : ''} ${LEAF} Return per schema: 'done' (stage complete), 'left-path' (STOP-4: the approach changed or the obligation is parked with owner and trigger, unsafe partial changes reverted — report what resisted), 'harness' (something outside the process broke — report what).${
      stage === 'PICKUP'
        ? ' PICKUP prepares the contract and its RED tests on the branch (committed, no implementation) and sets needsContractRed per RDY-8; unit = the contract path after compile/split.'
        : ''
    }`,
    { label: unit ? `${stage}:${short(unit)}` : stage, phase, schema: EXIT },
  )

const review = (checkpoint, unit, base, prev, phase) =>
  agent(
    `You are the fresh independent reviewer (REV-11), read-only: never edit tracked files, never commit. Invoke rifty-review for ${checkpoint} of ${unit} against BASE ${base}. Read ${CANON} §Review rules and apply its evidence bar; use raw evidence (diff, contract, carriers, probes in a detached scratch copy); inspect changed checking criteria against BASE (PR-4).${
      prev ? ` Verify pass: the prior verdict is ${prev}; review the actual changed tree, including whether the fixes work; prior rulings are evidence, not immunity.` : ''
    } Write the review-schema JSON (tools/review/review-schema.json) to <mktemp -d -t rifty-review.XXXX>/verdict.json, run node tools/review/blockers.mjs on it, and return per schema: pass = exit 0, verdictPath, exitCode, blockers = every finding of severity blocker (authority + summary verbatim).`,
    { label: `${checkpoint}:${short(unit)}`, phase, schema: REVIEW },
  )

const critic = (checkpoint, unit, verdictPath, disputed, phase) =>
  agent(
    `You are the fresh critic (DEC-5), read-only: never edit tracked files. Adjudicate the disputed blockers of ${checkpoint} for ${unit} in ${verdictPath}: ${disputed.join(' | ')}. Per ${CANON} §Review run 1 record HOLDS / FALSE / STRETCH with the clause and evidence as 'adjudication' in that same JSON (a Fidelity blocker is FALSE only with the discriminating carrier cited file:line). Return one line per ruling.`,
    { label: `critic:${short(unit)}`, phase },
  )

const stalled = (prev, cur) => cur.filter((b) => prev.some((p) => p.authority === b.authority && p.summary === b.summary))

// One checkpoint: review → reception (FIX / NOTE / dispute → critic) → verify, until PASS, STOP-3 stall, or the valve.
async function checkpoint(name, unit, base, phase = 'Units') {
  let prev = null
  let prevBlockers = []
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const r = await review(name, unit, base, prev, phase)
    if (!r) return { outcome: 'harness', report: `${name} reviewer returned nothing` }
    if (r.pass) {
      return run(name, unit, `The reviewer PASSED (verdict ${r.verdictPath}): do §Review run 3 — add reviewed_sha, validate with tools/review/blockers.mjs, post the JSON on the PR, record the ${name === 'Contract+RED' ? "contract's 'ready-verdict:' line" : 'reference the ledger will cite (REV-8)'}; commit.`, phase)
    }
    const same = stalled(prevBlockers, r.blockers)
    const list = r.blockers.map((b) => `[${b.authority}] ${b.summary}`).join(' | ')
    let x = await run(
      name,
      unit,
      same.length
        ? `STOP-3 stall: ${same.length} blocker(s) survived the fix + verify pass unchanged (${same.map((b) => b.summary).join(' | ')}). Do STOP-4, never another fix of the same kind: check authority and diagnosis, choose a materially different design or a discriminating probe, or park the obligation and revert unsafe partial changes; report 'left-path' when the unit leaves the path.`
        : `The reviewer returned blockers (verdict ${r.verdictPath}): ${list}. Do §Review run 1–2: verify each against its authority and evidence (REV-12) — a valid blocker is FIX, advice is NOTE; list the blockers you dispute in 'disputed' and stop there (a fresh critic rules; the implementer cannot dismiss its own defect); otherwise fix the surviving blockers together and commit.`,
      phase,
    )
    if (!x) return { outcome: 'harness', report: `${name} reception returned nothing` }
    if (x.outcome === 'done' && x.disputed?.length) {
      await critic(name, unit, r.verdictPath, x.disputed, phase)
      x = await run(name, unit, `The critic adjudicated ${r.verdictPath} ('adjudication'): fix every HOLDS blocker together with the undisputed ones, NOTE STRETCH/FALSE; commit.`, phase)
      if (!x) return { outcome: 'harness', report: `${name} reception after critic returned nothing` }
    }
    if (x.outcome !== 'done') return x
    prev = r.verdictPath
    prevBlockers = r.blockers
  }
  return { outcome: 'left-path', report: `${name} on ${unit}: ${MAX_PASSES} verify passes spent (harness valve; raising maxPasses is the user's decision) — STOP-4` }
}

const stop = (kind, report) => ({ stop: kind, goal, report })

phase('Preflight')
let st = await state('state:initial', 'Preflight')
if (!st) return stop('harness', 'state read returned nothing')
if (!st.goalReady) return stop('precondition', `${DIR} is not ready — FIT runs with the user present (rifty-goal), not here`)
if (!st.treeClean) return stop('precondition', 'dirty tree — commit or drop local changes first')

phase('Units')
let landed = 0
for (let i = 0; !st.mapEmpty || !st.hasCarrier; i++) {
  if (i >= MAX_UNITS) return stop('harness', `${MAX_UNITS} unit iterations without CLOSE — runaway guard`)
  let x
  if (!st.hasCarrier) {
    x = await run('RECHART', null, 'The goal has no acceptance carrier: the carrier is the next unit (RECHART 2); seed it on the map.')
  } else if (!st.unit) {
    return stop('report', `map non-empty, no open unit — every remaining row is blocked. ${st.notes}`)
  } else {
    let unit = st.unit
    x = st.unitCertified ? { outcome: 'done', report: 'certified', unit } : await run('PICKUP', unit)
    if (x?.outcome === 'done') {
      unit = x.unit ?? unit
      if (x.needsContractRed) x = await checkpoint('Contract+RED', unit, st.base)
    }
    if (x?.outcome === 'done') x = await run('IMPLEMENT', unit)
    if (x?.outcome === 'done') x = await checkpoint('Final+GREEN', unit, st.base)
    if (x?.outcome === 'done') {
      landed++
      x = await run('RECHART', unit, 'The slice landed (Final+GREEN PASS, verdict on the PR): RECHART 1–4.')
    } else if (x?.outcome === 'left-path') {
      x = await run('RECHART', unit, `The unit left the path (STOP-4): ${x.report}. RECHART 1 and 3: keep the obligation linked with owner, dependency and trigger; revert unsafe partial changes; continue independent work.`)
    }
  }
  if (!x) return stop('harness', 'a stage leaf returned nothing')
  if (x.outcome !== 'done') return stop(x.outcome, x.report)
  st = await state(`state:${i + 1}`)
  if (!st) return stop('harness', 'state read returned nothing')
}

phase('Close')
const cl = await checkpoint('Final+GREEN', `the whole goal ${DIR} end to end — every invariant executed on the real scenario (CLOSE 1)`, st.branchBase, 'Close')
if (cl.outcome !== 'done') return stop(cl.outcome, cl.report)
const done = await run('CLOSE', null, 'CLOSE 1 passed (the end-to-end verdict is on the PR). Do CLOSE 2–4, then merge per PR-6 and DEC-3; wait for gh pr checks at HEAD.', 'Close')
if (!done) return stop('harness', 'CLOSE returned nothing')
if (done.outcome !== 'done') return stop(done.outcome, done.report)
return { closed: true, goal, landed, report: done.report }
