---
name: rifty-review
description: Review a pull request for the rifty project — implementation completeness, fit with project goal and architecture, and bugs. Manual invocation only.
disable-model-invocation: true
---

Review the PR.
Especially interested in:
- Completeness of the implementation and absence of deferred/unresolved tasks
- Conformance to the project goal and architecture
- Goal drift — the PR ends promising what it started promising. Two probes: (1) delivered user-visible outcome ≡ the originating contract (item Acceptance / User scenario, epic Outcome, Contract+RED framing) — silent narrowing or a weaker delivered behavior is a blocker, not a nit; (2) diff every backlog/epic/ADR doc the PR touches vs base — a contract-wording edit (Acceptance, User scenario, Out-of-scope, epic Outcome/value, softened title/why) landing in the same PR as its implementation is the contract-level "never edit a test to make code pass". A genuine mid-PR contract change is legitimate only as an explicit recorded decision (re-refine or superseding ADR, named in the PR description), never a renarration to fit the code
- Approach earns its cost — even an on-goal capability is wrong if its implementation is disproportionate or net-negative for user or project; flag and reconsider, don't force it
- Budget — when the owning epic declares `## Budget`, count the run against it (scope outside ready items, contract edits, new mechanisms, review rounds, diff mass vs estimate); over budget is a finding, never silently absorbed
- Absence of bugs
- No regressions to existing functionality
- Feature's user experience matches the real ecosystem

Apply `docs/process/fault-classes.md` §Review convergence. Contract+RED checks the pinned oracle, complete contract, and executable RED proof. Final+GREEN checks the implementation against that frozen contract. Every correctness blocker names its fault class, missing RED proof, and unswept sibling surface. A Final+GREEN blocker means redesign/split, never another point-fix round.

## Report
Open with an overall verdict + merge call. Then one section per axis above (in order), each with its own verdict (pass / concern / blocker) — never folded into a flat severity-ranked list, never downgraded to a nit. Cite file:line.
