# ADR 0427: Lazy chat over the public Pi agent session

Status: Accepted
Date: 2026-09-12

## Context

Goal ai-agent-mode-and-bench I5 requires a reference +chat UI over the delivered
headless Pi core (ADR-0424). Current Playground owns its ProjectSession, document
view, preview selection and terminal presentation. The old PR-111 UI is a quarry;
its runtime/FS adapters and key persistence are not the current contract.

## Decision

1. Load the chat component and Pi only after +chat opens. Capture the bound
   project; unmount on close/project change stops and disposes that session.
   Closing clears the conversation (the old panel's onCleanup behavior);
   Stop alone retains it. Reset clears conversation, never project files.
2. Store only endpoint/model in safe localStorage. Optional key and limits stay
   in the mounted panel's memory. Applying settings explicitly starts a new
   conversation; disable conflicting controls while running. Defaults match core:
   100 calls/180 seconds. Unavailable storage keeps usable in-memory settings and
   reports that persistence failed.
3. Adapt the same public Workbench host. PlaygroundTerminalUi adopts the
   dedicated public ProjectTerminal; agent shell uses its existing runLine/stop
   settlement so labels, output and busy status remain the ordinary terminal
   presentation. Capture output from that real terminal. Recreate a user-closed
   idle agent tab on its next command. No second terminal registry or process owner.
4. Preview tools use the currently selected PreviewPanel URL/frame through an
   explicit callback. File writes use public ProjectFiles and existing editor/SCM
   subscriptions. No App VFS fallback or inferred /preview URL.
5. Dev-only /ai-proxy forwards to RIFTY_AI_PROXY_TARGET when configured. Browser
   transport failures show the existing core's CORS remedy. Production endpoints
   must be accessible from the browser; no server-side credential store.
6. Under ?agentBench=1 only, expose seed/exportTrace/session metadata through
   public host/session APIs. Seed requires idle chat and uses the same file
   capabilities; benchmark sends through the actual input UI. Hooks add no model
   tools, transport or runtime privileges and carry the required private marker.

## Alternatives and existing owners

- Chosen: lazy presenter + public host, with shell through the existing terminal
  UI owner. Existing runLine returns settled exitCode; native terminal supplies
  actual output. No new scheduler, lock, replay ledger or lifecycle generation.
- Rebuild terminal state from agent events: duplicates the existing UI owner and
  loses native Stop/close/busy behavior. The existing terminal adapter is the
  direct reusable seam.
- Port PR-111's FS/runtime controller or alternate layout: rejected by I1/I5 and
  the accepted +chat-only decision. Current public adapters already carry the work.
- Persist a key or conversation to retain it after unmount: excluded by the
  user's key policy and export-only persistence decision.

## Consequences

One conversation belongs to one bound project. UI keeps Pi event/result meanings,
including provider error, Stop and budget-exceeded. Export uses core redaction
and real SCM diff. Existing App helpers may move to focused modules to keep its
file-size ratchet; no unrelated behavior change.
