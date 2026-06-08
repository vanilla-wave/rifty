# Decision workflow — anti-patterns & when-in-doubt

On-demand elaboration of `CLAUDE.md` ("Design decisions during work" + "Hard rules"). Read this when you hit a fork. The **binding** rules live in `CLAUDE.md`; this file is the worked cautions, kept out of the always-resident file to save per-turn context.

## Anti-patterns (things you'll be tempted to do — don't)

### "Let me just stub this for now"
No. Throw `NotImplementedError` with a clear message. Stubs that return fake values create subtle bugs downstream.

### "The test is too strict, let me relax it"
No. Tests encode behavioral contracts. If you think one is wrong, file an issue and discuss — don't edit the test.

### "I'll skip the parity test, the unit test is enough"
For Node-compatible behavior, parity tests catch things unit tests can't (subtle semantic differences, edge cases). Default to parity unless there's a specific reason not to.

### "This pattern would be cleaner with a back-reference"
No reverse imports. If you find yourself wanting one, the abstraction in the lower layer is wrong — fix it there, not by inverting deps.

### "Let me add this convenient helper from npm — only 50 lines"
Each new dependency is a long-term commitment (and counts as IRREVERSIBLE per checklist). Check: is it broadly useful, or could I write the 50 lines myself? Bias toward zero-dep small helpers in `packages/*/src/utils/`.

### "I'll fix three things in this PR since I'm here"
One change per PR. Noticed unrelated issues? File separate tickets.

### "I'll overwrite this ADR to fix it"
No. Active ADRs are immutable. To change a recorded decision, write a new ADR (`pnpm adr:new <area>`) that supersedes it; the old one is removed with its context grafted into the successor and a removed→successor pointer in `docs/adr/README.md`.

### "I'll stop and ask about this"
Don't. Decide and record it: REVERSIBLE → `docs/backlog/<area>/` + `TODO(backlog: <area>/<slug>)`; IRREVERSIBLE → a new inline ADR with options + trade-offs. Then continue. The only fork you don't settle inline is **overturning a decision that's already recorded** — for that, spin up an explicit decision subagent that produces the superseding ADR.

## When in doubt

- Check if a similar pattern exists elsewhere (`rg` is your friend)
- Check the relevant ADR
- Apply the Reversibility checklist (to decide *where* to record, not whether to pause)
- If IRREVERSIBLE and unclear: pick the best-justified option and record it in a new ADR (options + trade-offs); don't stop. To change a decision that's already recorded, use a decision subagent.
- Never assume Node/Anthropic/StackBlitz behavior without verifying — use the parity-runner to check Node's actual behavior
