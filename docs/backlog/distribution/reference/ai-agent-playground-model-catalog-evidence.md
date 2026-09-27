# Image/catalog chat — preparation

Authority: agent-weak-models I3/I4, I2 interaction; ADR-0471. BASE catalog
Final+GREEN c5bb64273b863696b97d4f27977e6761dbd2bb0e.

## Oracle and RED

`pnpm exec vitest run packages/agent/src/images.test.ts`: 6/6 RED.
The tests execute native pi-agent-core/pi-ai 0.85.1 Agent.prompt first, through
real pi serialization and an external scripted fetch only. Native accepts the
same text+PNG and empty-text+PNG prompts; rifty respectively drops image data
or throws "Agent prompt is empty". Text-only and PDF/typed-byte cases resolve
instead of the promised pre-dispatch refusal. No import/type error is the RED.

`RIFTY_PLAYGROUND_PORT=5398 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts --grep 'catalog controls|binary attachment'`:
new scenarios reach the real Settings form and fail on missing Advanced catalog.
They carry subsequent checks for retained tool results/defaults after provider
switch, native image bytes, binary project bytes and a filename collision.

## Carrier decisions and authority

- Native catalog JSON in an advanced section, plus existing simple controls:
  exposes I1 fields without a second model schema. Built-in browser transport
  stays OpenAI-compatible; custom Providers stay the embedder's native seam.
- Catalog and selected id persist; provider keys/headers and run limits do not.
  Existing endpoint/model storage migrates to a one-entry native catalog.
- File picker is the input source. Native image blocks stay pending until user
  message admission. Other bytes use ProjectFiles under /attachments; unique
  names plus expectedVersion:null preserve prior files. Visible paths are
  inserted into the sent prompt. No binary-to-text conversion.
- Empty text with images follows the executed pi oracle; empty text without
  images retains the existing refusal. No automatic model fallback.

No mechanism or task-set change: I12 still runs before I5–I11.
