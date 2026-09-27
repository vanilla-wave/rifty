# Tool feedback — preparation

Authority: goal I7–I11; reviewed continuation b353ed8b0, supplemental browser
fixture5c6100731. No production implementation in this preparation.

Independent DEC-2: `/private/tmp/rifty-pr359-tool-feedback-decision.md`;
executed `node --experimental-transform-types
/private/tmp/rifty-pr359-tool-feedback-seam.mjs` (output same stem.out).
Real Pi0.85.1 + MemoryVfs: before/after skip invalid/missing, awaited end event
covers all four calls; decoration reaches events/history/next wire; native steer
after third preserves fourth batch effect (file vw). Missing required field is
invalid; numeric text is coerced by Pi and is not a valid RED injection.

RED:
- `packages/agent/src/tool-feedback.fault.test.ts`: 14 failed/1 passed;
  `/private/tmp/rifty-pr359-tool-feedback-red2.log`. Actual Agent/MemoryVfs:
  defaults/envelopes, invalid/missing/blocked/host-error/Stop receipts, Unicode
  cap, exact edit counts/hint/no-write, repeated calls/key order/across-send/reset,
  stable capped body across budget widths, consumer envelope/plain data,
  unavailable/pending diagnostics, recipe/default/opt-out.
- Real Workbench+TypeScript: `agent-core.spec.ts` diagnostics-after-mutations
  case fails because write result has no diagnostic feedback, while mutations
  succeeded. `/private/tmp/rifty-pr359-tool-feedback-browser-red.log`.
- TypeScript passes `/private/tmp/rifty-pr359-tool-feedback-types.log`.

Remaining GREEN proof: rejection/late diagnostic settlement, deleted patch path,
long metadata and unchanged consumer domain semantics, refreshed public chat
600s default, actual native benchmark recipe parity. Keep existing host policy,
CAS/effect, Stop, images and continuation acceptance.

Route: native Agent owns dispatch; tools own exact transforms and changed paths.
Result formatting happens once at an owned boundary, with a fixed budget-heading
reservation before body truncation. Never interpret file bytes as metadata merely
because they resemble JSON. No new dispatcher, history owner, correlation map,
diagnostics cache or epoch. ADR0475 records API/profile decisions.

Contract+RED F1 accepted: headless-only recipe mutant passes the original core
recipe test while actual native extension omits it. Added committed actual Pi
SDK/extension wire test `tools/agent-bench/src/prompt-recipe-parity.test.ts`.
It loads the generated nativeExtension, proves actual request/system-prompt file
agree and old paragraphs exist, then fails on absent recipe. RED:
`/private/tmp/rifty-pr359-native-recipe-red.log`. No production change.

Added unchanged-baseline metric guard: a real Agent/MemoryVfs budget-blocked
proposal remains uncounted after envelope formatting; I12 semantics stay fixed.
The new native test also kills the reviewer's headless-only mutant on actual
model wire: `/private/tmp/rifty-pr359-native-recipe-mutant-red.log` (profile.recipe
exists; native prompt lacks it). Agent-bench typecheck passes; metric guard6/6
passes `/private/tmp/rifty-pr359-feedback-metrics-baseline.log`.

## Implementation proof

Native end-event receipts preserve execution authority and existing admission
counts. Final capping moved from wrapTool to the receipt boundary; streaming
consumer updates retain their old cap. This prevents double truncation and keeps
JSON headings intact. Existing consumer-envelope recognition requires native
scalar types and matching details; file bytes are never parsed as metadata.

- First GREEN:15 core feedback +native recipe +6 metrics =22/22,
  `/private/tmp/rifty-pr359-tool-feedback-green1.log`.
- Extended fault coverage24/24: Unicode/large metadata, consumer false positives,
  failed-edit repetition, late/rejected diagnostics, deleted paths, reset budgets.
  `/private/tmp/rifty-pr359-tool-feedback-fault-final2.log`.
- Diagnostics rendering failure RED (actual write succeeded but tool was marked
  failed) and repair: `/private/tmp/rifty-pr359-feedback-diagnostics-format-red.log`.
- Array-valued consumer status RED and strict-grammar repair:
  `/private/tmp/rifty-pr359-feedback-consumer-grammar-red.log`.
- Real Workbench browser18/18:
  `/private/tmp/rifty-pr359-tool-feedback-browser-final.log`.
- Full prior chat15/15: `/private/tmp/rifty-pr359-tool-feedback-chat.log`.
- Composed I7/I8/I9 chat: four rejected exact edits, one visible native steer,
  subsequent real read_file proves file unchanged; no suppressed calls:
  `/private/tmp/rifty-pr359-tool-feedback-repeat-browser3.log`.
- First full gate25/25: `/private/tmp/rifty-pr359-tool-feedback-pr-check1.log`.
  Final unchanged-source confirmation remains before delivery.

PR-4: default-prompt golden gains only the declared recipe and static receipt
explanation; four shared paragraphs remain. UI reload default180→600 per I9;
explicit caller180 overrides remain. Native benchmark profile expectationv1→v2
and paragraph assertions include recipe. Browser BOM/diagnostic checks now assert
JSON receipt plus exactly the prior body semantics, rather than requiring the
old no-header shape. No task/judge/config baseline changed.

New composition-test harness corrections: there is no capture() bench hook;
use actual read_file, explicitly included in the scripted sequence. Those two
harness failures are retained in repeat-browser{,2}.log; not product failures.
Whitespace hints rank the first nonempty old line after whitespace removal by
shared prefix/suffix proportion, exact normalized equality first, first-line ties.
This is locating advice only; all writes still require one exact full old match.

Final focused suite120/120: `/private/tmp/rifty-pr359-tool-feedback-focused-final.log`.
Final gate25/25, no isolation: `/private/tmp/rifty-pr359-tool-feedback-pr-check-final.log`.
Full mock-model smoke passed all14 real task/lane pairs and shared recipe wire
assertions; COI/native budget cases passed. No-COI budget preparation overlapped
that gate's dist rebuild and packaged missing runtime-js outputs; it failed before
an agent request. Missing files exist after build. Sequential isolated proof is
`/private/tmp/rifty-pr359-tool-feedback-no-coi-isolated.log`; no production workaround.
Keep the original failure `/private/tmp/rifty-pr359-tool-feedback-real-lanes.log`.
Sequential no-COI budget rerun PASS1/1 (1.7m), same code, no build overlap.
All required smoke/budget cases now have passing execution evidence.

## Final review F1/N1 reception

F1 accepted: fixed4096-byte metadata cutoff removed fitting effects from model
wire. Independent probe BASE5134bytes includes applied:unknown, HEAD2102bytes
lost it. Added REDs at2500/6000-char padding plus oversized effect/patch/error
settlement cases. Fallback now preserves fitting metadata; only oversized headers
project bounded explicit applied/persistence/mutation outcomes, applied-path counts
and exact bounded samples, with omission marked. Remaining context is labelled
truncated; body capacity remains fixed for the configured budget widths.

N1 accepted: shell producer serializes Error through hostError; envelope comparison
now uses the same normalization. A single heading retains the real error message.

- `/private/tmp/rifty-pr359-feedback-effects-red.log`:3 RED.
- `/private/tmp/rifty-pr359-feedback-effects-overflow-red.log`:oversized provenance RED.
- `/private/tmp/rifty-pr359-feedback-original-review-probe-green.log`:original independent probe now GREEN; HEAD5165bytes, unknownVisible=true, actual next wire equals receipt.
- `/private/tmp/rifty-pr359-feedback-settlement-final.log`:35/35 (29 fault +6metrics).
F1/N1 repair full gate25/25, no isolated rerun:
`/private/tmp/rifty-pr359-feedback-effects-pr-check.log`; current types/lint pass.
