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
