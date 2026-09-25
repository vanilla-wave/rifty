# ADR 0466: Restore native agent conversation history

Status: Accepted
Date: 2026-09-25

## Context

Issue #355: external hosts patch published agent code to restore native history.
ADR-0424 owns the session; ADR-0436 publishes native Pi 0.85.1 types.

## Decision

- Add optional readonly AgentMessage[] initialMessages to common session options.
  Clone at creation; seed Pi initialState.messages. reset clears it.
- Reject unsupported message envelopes and unpaired, duplicate or mismatched tool
  results with TypeError naming initialMessages before host/model work. Calls need
  matching results in the immediately following tool-result group. Never replay tools.
- Add restoredMessageCount to trace v1: first N transcript messages are restored.
  Events, timings and aggregate usage describe only this session; reset sets N to zero.
- Host owns storage, decoding native messages, project reset and model selection.
  README documents the public flow; Playground lifecycle ADR-0427 is unchanged.

## Alternatives

- Native seed plus strict pairing admission: chosen; issue explicitly permits rejection.
- Synthesize failed results: permitted by issue but cannot know effects of interrupted
  host work. Existing host-generated isError results remain accepted.
- Require external dist patch: rejected; does not meet the issue's release compatibility.

## Evidence

Pi 0.85.1 initialState.messages and reset probe, RED and browser proof:
docs/backlog/distribution/reference/agent-history-evidence.md.
