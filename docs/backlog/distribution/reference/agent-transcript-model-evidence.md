# Headless transcript — I7

Baseline8d55757fc; Pi0.85.1, Node24.16.0. Actual sessions over MemoryVfs and
scripted model HTTP (only substituted boundary):
`node --import tsx /tmp/rifty-pr357-transcript-probe.mts`
`node --import tsx /tmp/rifty-pr357-transcript-success-probe.mts`
`node --import tsx /tmp/rifty-pr357-transcript-continuation-probe.mts`

Normal agent_end roles: user/assistant/toolResult/toolResult/assistant.
Budget1 with two writes: all real user/tool events occurred; first file exists,
second absent, receipts success/cancelled(applied:no). Terminal agent_end contains
only aborted assistant; exportTrace still retains the preceding user/tools.
Current Playground replaces the tail and therefore loses those rows.

Retry503→success emits native retry start/end; actual summary preparation with
reserve512/keepRecent128 and long prior/latest turns emits compaction start/end,
tokensBefore3902, tokensAfter704, success, retainedMessageCount2. A short latest
turn legitimately leaves no cut; no fabricated compaction marker. Model switch
emits model(other/local). Raw snapshots: `/tmp/rifty-pr357-transcript-{budget,
success,retry,compaction}.json`.

RED2026-09-30:
- `pnpm test:run packages/agent/src/transcript.test.ts`:6 expected API-availability
  assertion failures after actual agent scenarios, no broken import. Prospective
  API acquired via module namespace; noop/missing projection cannot satisfy rows.
- `RIFTY_PLAYGROUND_PORT=5520 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts -g 'headless transcript'`:
  two behavioral failures. Budget status reached but prior user/tools absent;
  real terminal prints TRANSCRIPT_LIVE_OUTPUT but chat has no output surface.
  The same test asserts cancelled state after Stop once output is rendered.
- Agent typecheck passes after a test-only explicit filter type predicate;
  no product implementation in this preparation.

Raw logs: `/tmp/rifty-pr357-transcript-red.log`,
`/tmp/rifty-pr357-transcript-ui-red.log`. Real UI screenshots retained by Playwright.
