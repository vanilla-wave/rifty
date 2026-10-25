# Agent history evidence — issue #355

Baseline: 2c9bbd30109692647c0174f8930f713007150f67.
Source: https://github.com/vanilla-wave/rifty/issues/355 (body fetched 2026-09-25, no comments).

## Reference

Node v24.16.0, Pi core 0.85.1, cwd packages/agent:

```js
import { Agent } from '@earendil-works/pi-agent-core';
const messages = [{role:'user',content:'persisted',timestamp:1}];
const agent = new Agent({initialState:{messages},streamFn:()=>{throw new Error('unused')}});
console.log(JSON.stringify(agent.state.messages));
agent.reset();
console.log(JSON.stringify(agent.state.messages));
```

Output: `[{"role":"user","content":"persisted","timestamp":1}]`, then `[]`.
Native initialState/reset are reused. Admission and provenance are rifty's new API,
not claimed provider parity. Network response scripting is the external boundary;
actual Pi Agent, provider serializer and Workbench run in the browser proof.

## RED

`pnpm test:run packages/agent/src/history.test.ts`: 10 failed, 1 passed.
Seed absent, provenance absent, malformed history accepted; ordinary session still works.

`RIFTY_PLAYGROUND_PORT=5391 pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts -g 'fresh headless'`:
1 failed at restored.transcript equality: expected persisted messages, received [].
Real Workbench wrote the file; fresh native session discarded its captured message_end history.

Independent contract_review required a discriminating isError assertion; repaired at
b9dbd490888cc3f5fb3d3dc8a0a27dd0c384aee2. Updated unit RED: 11 failed. Original BLOCK
and accepted verification retained alongside this evidence. Scope and Challenge clear.

## Native prompt expectation correction (PR-4)

First GREEN attempt: 2 failures; isolated history.test.ts rerun reproduced both.
Expected string content after fresh send was wrong. Independent contract_review
repeated `new Agent({streamFn:(_m,c)=>{console.log(JSON.stringify(c.messages));
throw new Error('probe end')}}).prompt('fresh')` under Node v24.16.0 / Pi 0.85.1.
Output content: `[{"type":"text","text":"fresh"}]`. Corrected only fresh-message
expectations; retained exact seed/reset assertions. Reviewer record adjacent.

## GREEN

- `pnpm test:run packages/agent/src/history.test.ts packages/agent/src/session.test.ts`: 18 passed.
- `pnpm --filter @riftydev/agent typecheck`: passed.
- `RIFTY_PLAYGROUND_PORT=5391 pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts`: 17 passed (18.0s).
  Prior run: 16 passed, one fixture boot lost execution context while driver edited imported history.ts (HMR).
  Isolated CAS repeat: passed; full repeat on stationary tree: passed. No test or fixture weakened.
- Omitted-property advisory covered by a separate absent initialMessages test.

- `pnpm pr:check`: all 25 lanes passed. test:run had one assertion failure in
  runtime-smoke-child.test.ts (expected SIGTERM handler diagnostic); zero Vitest
  time-outs. Gate's mandatory isolated rerun passed; load 20.7/30.1/19.3 on 12 CPUs.
  Contention suspected, not proven; no source/test change made for this non-reproducing failure.
- Built `packages/agent/dist/index.js` restore/reset smoke passed via Node `--import tsx`
  (workspace dependencies export TS sources). Plain Node's strip-only loader cannot load
  an existing dependency parameter property; not a published-package claim.

## Final review

Independent final_review: Final+GREEN PASS at 55f756c5f4acedc83713790980361d809fcde54d;
10 coverage rows, no findings/residuals. Unit/session 18 tests independently repeated.
Completed temporary contract removed; review reads its reviewed revision.

## PR review repair — required native fields

Greptile discussion_r4099302456: assistant without usage or tool call without arguments
was admitted before host work. Accepted: corrupt-input at history admission; required
field validation was incomplete. Sibling sweep: user/assistant/toolResult required
fields and their native content variants at the same boundary (Pi 0.85.1 types.d.ts).

- RED: `pnpm test:run packages/agent/src/history.test.ts` — 12 new failures, 12 existing passes.
- Fix: validate required identity, stopReason, usage/cost numbers, isError and content
  payloads before host work; pairing stays at the same boundary. Optional provider
  metadata preserved; host still owns JSON parsing/migrations.
- GREEN: history/session suite — 30 passed; agent typecheck passed.
- Browser agent-core rerun: 17 passed (16.3s).
- Full `pnpm pr:check` after repair: 25/25 passed; test:run passed first attempt (228.7s), no isolated reruns.

Independent final_review verify: Final+GREEN PASS at e8f41f1920c602d3fa4ffc2da4d62dede9ca59d9.
Reviewer acknowledged original admission miss, independently reran 30 tests and
verified preservation of valid optional metadata/deep isolation. No residuals.

## Interrupted-proposal admission repair

Driver and final_review independently found a reachable accepted seed with an
aborted/error assistant toolCall plus the host's synthetic isError result. Pi 0.85.1
transformMessages/convertMessages drop the assistant but retain an orphan tool result.
Independent public-session probe: admitted each seed, host called twice; native wire
roles [tool] for aborted/error, [assistant, tool] for toolUse control.

Authority: issue #355 interruption and host-independent pairing, historical Acceptance 1 /
Fault 3. Existing session completeSkippedCalls already excludes aborted/error proposals.
Decision: reject these incomplete proposals before host work even when paired; preserve
text-only interrupted messages and ordinary toolUse + isError. No stripping or invented stopReason.

RED: `pnpm test:run packages/agent/src/history.test.ts`: 2 failed / 26 passed before fix.
Native probe (Node v24.16.0, Pi 0.85.1): transformMessages([assistant with stopReason
aborted, toolCall id interrupted/name action/arguments {}, full native metadata,
paired isError toolResult], new rifty/openai-completions model) returned only toolResult.
Independent reviewer confirmed both reasons through actual convertMessages.
- GREEN after interrupted-proposal repair: history/session 34 passed; agent typecheck passed;
  browser agent-core 17 passed (17.6s); full pr:check 25/25, test:run first attempt (227.8s).

Independent final_review verify PASS at e467bf5bcf1fdbeac79ec6b032c806ff52fb5de6:
34 tests independently passed; actual default transport rejects aborted/error proposals
before host/fetch, normal toolUse + isError retains valid native wire. No residuals.
