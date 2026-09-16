# ADR-0439: Settle probe cleanup against the terminated Worker's OPFS lock

Date: 2026-09-16. Status: accepted.

## Context

ADR-0437 decision 5 orders probe teardown as Worker termination, then scratch
deletion. Chromium releases a terminated Worker's OPFS sync access handle
asynchronously, so a deadline expiring inside the OPFS phase makes the first
`removeEntry` meet that lock: observed `NoModificationAllowedError` →
`cleanup: failed` plus a scratch directory nothing else removes. RED and repro:
`docs/backlog/distribution/reference/workbench-sandbox-support-followup-evidence.md`.

## Decisions

1. Termination order stands. The scratch removal treats
   `NoModificationAllowedError` as the expected settlement of its own just
   terminated Worker and retries until the removal succeeds or the cleanup
   deadline ADR-0437 decision 5 already owns expires. No new deadline owner,
   queue or correlation state; every other rejection stays immediate.
2. A lock outliving that deadline remains an explicit `cleanup: failed` with the
   native error, never a silent leftover. Late uncancelable effects keep
   ADR-0437's single-attempt disposal: their deadline is already past.

## Alternatives and consequences

- Reporting the first rejection was the shipped behavior: it published a failure
  the caller cannot act on and leaked the probe's own directory.
- Awaiting a termination acknowledgement needs an API the platform does not
  offer; a second teardown authority would own the same key.
- Cleanup can now occupy its deadline waiting for a lock. That is the phase's
  declared budget, and the report already distinguishes `incomplete` from
  `failed`.
