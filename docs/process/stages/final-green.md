# Final+GREEN — prove the delivered result

Review the current unit diff from BASE (prior accepted slice, otherwise branch
base), on a clean committed tree with `pnpm pr:check` green. Procedure:
`checkpoint-run.md`; the same format and validator for every kind of change.

The reviewer checks the current contract/baseline, preparation required by
`RDY-8`, real acceptance proof and any changes to the judging criteria (`PR-4`).
A filename, a ready flag, or a passing test with a fake cannot close a claim.

PASS → record the verdict at the reviewed SHA (`REV-8`). Inside a goal continue
RECHART; standalone work may delete its completed draft, then run `pnpm check:pass-binding` and merge when the
binding holds. A document deletion neither grants nor invalidates a verdict.
Blockers → verify, fix or independently adjudicate, then re-review the changed
result. Surviving technical problems follow `STOP-3..4`, never a fake GREEN.
