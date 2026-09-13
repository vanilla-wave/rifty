# ADR 0431: Present owned commands through the existing input lifetime

Status: Accepted
Date: 2026-09-13

## Context

PR-333 executed the same real Node command through user Enter and the agent.
Both produced stdout UI_PART_DONE. User terminal kept one line; the agent's
out-of-band writes redrew prompts between chunks (UI_PART / _DONE).
PlaygroundTerminalUi owns process settlement; RiftyTerminal owns line-input
presentation/busy/raw-input state. Bypassing the latter does not preserve output.

## Decision

1. Add `RiftyTerminal.executeLine(line, execute)` over the existing Enter body.
   It echoes the line, enters the same input/busy/command-block lifetime, calls
   the supplied owner once and returns its number/undefined or original error.
   Busy/disposed calls reject. Interactive submitLine retains its void contract.
   Validation that leaves incomplete input returns undefined, never invented success.
2. A mounted TerminalPanel binds a presenter to the existing UI terminal record.
   The agent enters that presenter, whose callback invokes ordinary runLine
   with the original AbortSignal. Backend settlement and output stay public
   ProjectTerminal's; the view adds no command queue or process ownership.
3. Presenter detach captures its existing record/identity, so teardown cannot
   clear another project's reused terminal id. Disposal avoids drawing a prompt
   or marker into a dead widget; the caller still owns stopping its command.

## Alternatives and sweep

- Out-of-band write plus manual input echo: killed by the executed split-stdout
  differential (`/tmp/pr333-ai-terminal-stream-red.log`). It also bypasses the
  existing busy input routing; content greps of echoed commands are not proof.
- A second externally-busy flag or callback/result correlation slot: rejected.
  RiftyTerminal already owns that lifetime; expose its result directly instead.
- Chosen: reuse its one Enter body and busy state. Existing UI terminal record
  owns the presenter registration; existing runLine owns native run/Stop/close.
  No fresh scheduler, synthetic terminal or lookup by display name.

## Consequences

Generic public terminal capability; no AI import. Links helpers/type move to
terminal-links.ts for the file-size ratchet, with the old exports preserved.
The backend callback remains authoritative even when the widget closes.
