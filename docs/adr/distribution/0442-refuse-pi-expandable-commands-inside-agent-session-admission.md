# ADR 0442: Refuse pi-expandable commands inside agent session admission

Status: Accepted
Date: 2026-09-22

## Context

ADR-0440 makes `send` await project resources. Playground checked commands
before creating the session, so the first pi-expandable input reached the
model literally. PR #347's UI wait was reverted: failed reads hung and slow
reads escaped the run budget. User authorized repairing this refusal gap.

## Decision

1. Classify inside the existing session run after its pending resource read
   and Stop/budget checks, before model/history dispatch. Refuse precisely
   loaded `/skill:<name>` and discovered `/<template>` commands that pi 0.85.1
   expands; retain pi's space-only skill split and template whitespace split.
   Other slash text remains literal. Playground owns its `/reload` command.
2. Throw `NotImplementedError` for unsupported expansion. Existing run error
   handling publishes `status: error` and `detail`; `send` retains its current
   Promise settlement contract. Refusal sends no model request and adds no
   transcript entry. Resource reload supplies the next classification snapshot.
3. Remove the UI classifier. Render the existing session error and retain the
   rejected draft. No readiness accessor, second resource read, queue or timer.

## Alternatives

- UI waits for a resource event: rejected by PR #347 failed/slow-read probes;
  the event is not a read-settlement contract.
- New readiness accessor plus UI classification: duplicates admission ordering
  and exposes lifecycle callers do not need. Existing `send` owns that wait.
- Expand skills/templates now: separate capability; refusal is the existing
  supported behavior being repaired.

## Consequences

- First and later commands obey the same refusal in every session consumer.
- Public `send` now reports these unsupported commands as errors; callers see
  the existing error status, and may recover with a normal message or reload.
- Arbitrary host reads still settle under the existing lifecycle; the budget
  prevents late model dispatch, without claiming to interrupt host I/O.
