# ADR 0517: Use accessible names for editable judge controls

Status: Accepted
Date: 2026-10

## Context

Extends ADR0512/0516's open-control observation seam; neither is overturned.
Eval-v6 Room lookup times out despite a named native combobox. Exact captured
HTML in Chromium148: getByLabel0/getByRole1. Pinned Vue reference40/40 PASS;
remove only label/select separator space: same accessible name, private13 RED.
After options appear, raw label concatenates values; purpose becomes unmatchable.
Textarea prose and multiple-select data also collide with other purpose queries.

## Decision

One editableControl owner selects actual role names; readonly/disabled filters
remain. Explicit ARIA-labelled contenteditable keeps its existing label fallback.
Actual native date/time/password/month/week/datetime-local/color are textbox;
file is button in the installed Chromium/Playwright pair. Native interaction
proof, not recalled role assumptions, controls the preserved surface.

Per-case caption patches retain the wrong projection; rejected by three native
REDs. Raw-label union admits prose as a different field; rejected. No new
execution/state owner, runtime feature or public task requirement.

## Consequences

Bookingv4/expensev4/eval-v7 retain public inputs, locks, controls, case judge bytes
and native-input-v1. Shared context changes every resolved judge fingerprint;
other six case entries remain. Eval-v6 interrupted84/96/47PASS37FAIL12missing,
original scores retained; two offline regenerations preserve603 authoritative
files. No rescore/resume/native rescue; fresh96 follows Final.

Eight native regressions, owner guards RED3/1/1→exact restore8GREEN, real Vue
consumers and four-host controls carry proof. Cold no-model Vue HMR failure
remains history; isolated identical source passes40/40. No universal HMR cause.
I10/I11 and whole-goal audit remain required.
