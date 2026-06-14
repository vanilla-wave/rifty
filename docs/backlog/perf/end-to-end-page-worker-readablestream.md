---
area: perf
subsystem: net
status: blocked
title: ADR-0093 — supersede ADR-0048 for end-to-end page<->worker ReadableStream (#22 fix b)
created: 2026-06-08
why: real page↔worker streaming overturns recorded M12/page-buffered deferral (ADR-0017 / ADR-0048 D2 / ADR-0055); bumps PREVIEW_PORT_FRAME_VERSION 2->3; REQUIRES a decision subagent
user_story: As a dev serving a streamed response from the preview, I want the first bytes to reach the page immediately, but today the page accumulates and concatenates every `≤64 KiB` frame before responding so I eat full head-of-line latency; true end-to-end `ReadableStream` is deferred to M12
sources: [perf-audit #22 fix(b)/§5, adr-plan B/ADR-0093, ADR-0048, ADR-0017, ADR-0055, draft ADR-0060]
---
## Context
preview-port.ts:379-414: worker chunks into ≤64 KiB frames but page copies each into a fresh Uint8Array then concatenates all before responding — 2× M copy + head-of-line latency. Fix(b) = real streaming. Contradiction: ADR-0048 D2 ("page still accumulates and concatenates on end; true end-to-end ReadableStream is M12"); ADR-0017 defers body:ReadableStream to M12; ADR-0055 §Risks "v3 frame bump DEFERRED … do NOT ship v3." Building streaming now overturns all three (rule3; rule1 also fires on versioned wire / PREVIEW_PORT_FRAME_VERSION 2→3). (Fix(a) — drop redundant page re-copy at 385-387 — is a separate NONE item in none-items-quick-wins.)
## Options / Next
ADR-0093 formally supersedes ADR-0048 (owns PREVIEW_PORT_FRAME_VERSION + page-buffered clause), cites ADR-0017 (M12 envelope) + ADR-0055 (opencode SSE compat depending on the deferral); aligns with named draft ADR-0060. Subagent reads ADR-0048/0017/0055 + draft 0060 and produces ADR-0093.
## Reversibility
IRREVERSIBLE — rule3 (overturns recorded deferral other work depends on) + rule1 (versioned wire bump). DECISION-SUBAGENT-REQUIRED (reconsidering a recorded decision — CLAUDE.md; the one item that overturns a recorded decision). BLOCKED on that subagent producing the superseding ADR.
