# Shell output order — I10

Baseline: e6eb4f97c. `standardTools` concatenated stdout then stderr; real
SDK events already preserved order. Fault: `lossy-aggregate` at the owned
in-process result projection; transport loss/duplication/reorder excluded.
Sweep: sandbox, workbench and playground shell adapters all stream both channels
into this single shaping point. Bench build/install logs are outside model text.

RED (2026-09-30):
`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi tests/no-coi/no-coi-pi-agent.spec.ts -g 'shell model text'`
Real Chromium + SDK Worker + scripted network provider: terminal
`first/second/third/fourth`; model text `second/fourth/first/third`.
Assertion at model-text body failed, exit 1; imports and real command passed.
The test checks exit 0/1, status heading, transcript and next provider request.

Carrier: collect the already-observed output chunks in `standardTools`.
Custom hosts that emit no chunks retain their existing outcome-only fallback;
all rifty host adapters emit chunks. No public API or coordination change.
