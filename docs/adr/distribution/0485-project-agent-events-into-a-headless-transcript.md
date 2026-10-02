# ADR 0485: Project agent events into a headless transcript

Status: Accepted
Date: 2026-09-30

## Context

Goal I7; ADR-0424/0427/0436/0471 keep the native Pi loop and host-owned rendering.
Playground owns an ad-hoc reducer that drops output/capability events, collapses
cancelled tools and replaces a run with agent_end.messages. Actual Pi0.85.1 budget
probe: that terminal may contain only the aborted assistant; preceding user/tools
remain in the real session transcript. Full-tail replacement loses them.

## Decision

- Export `createAgentTranscript()` and pure
  `reduceAgentTranscript(state, AgentSessionEvent)` from the agent root.
  State exposes ordered items, status/detail and latest capability values;
  projection metadata and stable numeric ids travel in the same immutable state.
- Message rows preserve user/assistant text and final native message; assistant
  streamingText is separate until message_end. Preserve native image content.
- Tool rows deduplicate proposal/start/end/message receipts by toolCallId in the
  current call; old settled calls survive reused ids in later proposals. States:
  pending/running/success/error/cancelled. Raw results and ordered output remain.
- Apply events incrementally. agent_end may supply missing tool receipts; it
  never replaces prior rows. Cancellation comes from actual result details,
  never an inference that a status alone proves unapplied effects.
- Native session tools are sequential (`session.ts`); output attaches to the
  running shell, unmatched output remains an explicit output row. No extra ids,
  queue, subscription owner or event channel.
- Assistant retry start retires its unfinished placeholder; the native discarded
  attempt remains in the retry notice payload. No incomplete ghost message.
- Notice rows retain model/retry/compaction/steering and terminal budget/context
  events. Capability notices reflect changes; identical repeated frames add none.
- Playground renders this model; no Solid dependency in the agent, no new UI
  component or store wrapper. Cross-session persistence/restore remains host-owned.

## Alternatives

- One pure projection over existing events: selected; moves existing UI state to
  the package and preserves native lifecycle facts.
- Consumer reducers: reproduce the same cancelled/output omissions, against I7.
- Render exportTrace only: loses live running/streaming state.
- Rebuild from agent_end: killed by executed native budget probe above.
