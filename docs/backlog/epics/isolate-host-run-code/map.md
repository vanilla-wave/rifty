# Map — isolate-host-run-code

## Items

1. `distribution/isolate-host-acceptance` — **acceptance carrier** — the
   `## User scenario` as executable tests over real isolated-vm, the built
   guest runtime and a live `node -e` oracle (I1–I6), committed RED before
   implementation.

Wall hypotheses the carrier is expected to hit (cut into units only when the
run hits them): one-script guest runtime + bare-V8 Web API shim sized by the
corpus; byte stdio sink, drain and exit in the guest; child process with
clean env, deadline/catastrophic/RSS/output kills; egress loud throws;
packaging (isolated-vm `allowBuilds`, arch tier, publish config) and consumer
README. Docs walls (no product RED): ADR-0557 (mission, dependency, process
boundary), `AGENTS.md` Mission line, `docs/public/trust-model.md` §Isolate
host, compat ❌ rows for the shim ceilings, `docs/ROADMAP.md` milestone line
(goals B–D named as directions only).

## Open questions

- Which Web APIs the corpus needs real vs loud (`URL`, `structuredClone`,
  web streams, `DOMException`, `crypto`) — owner: agent — run the carrier;
  needed → implement/bridge, not needed → `NotImplementedError` + compat ❌.
- Per-call cost (spawn + runtime load) — owner: agent — measure on the landed
  tree; recorded, not promised.

## Out of scope

- Host file operations on a live sandbox, `exec node <path>`, a long-lived
  instance across calls, FS snapshot export/import, a library template, the
  agent tool set, npm install in the guest, shell, consumer deploy topology.
- A process pool / long-lived worker process hosting many isolates
  (milestone direction line only).
- Drafts not absorbed: `distribution/public-api-ai-agent-contract-snapshot-restore`,
  `kernel/host-operator-resource-enforcement`, `distribution/ai-sandbox-reference-demo`.
- Network bridge guest → host (allow-listed RPC) — future goal.
