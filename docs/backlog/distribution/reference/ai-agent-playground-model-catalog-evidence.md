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

## Implementation proof

- Image API: images.test.ts 6/6 GREEN with the same native oracle.
- Initial UI GREEN attempt: provider switch reached done but exact getByLabel
  could not identify the nested select label. Added explicit matching aria-label.
- Attachment assertion reached the ordinary Export control, which was disabled
  until Stop project (existing workspace-archive and bench flow). Test now uses
  that public Stop action before download; exact byte/collision assertions stay.
  This corrects the archive setup, not the product criterion (PR-4).
- Targeted Chromium: settings persistence/reset, multi-entry catalog/reload,
  provider-error continuation, image and binary/collision flow: 3/3 pass.
- Contract advisory handled in the existing/new carriers: catalog reload and
  selected id, new-entry defaults, memory-only API keys and headers, unchanged
  run-limit clearing. The legacy exact two-field storage assertion migrated to
  the accepted catalog shape and retained secret exclusion.
- Preserved existing Settings normalization: adding surrounding whitespace to
  the retained settings e2e reproduced a RED (stored id/URL kept whitespace).
  Catalog parsing now copies then trims id/baseUrl, and normalizes selection;
  original key/limit/reset assertions remain. Raw RED:
  /private/tmp/rifty-pr359-settings-trim-red.log.
- Full `RIFTY_PLAYGROUND_PORT=5398 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts`: 14/14 pass (96s), including normalized stored fields, real React build/HMR, resource reload, native terminal/Stop and both new flows.
- `pnpm pr:check`: 25/25 pass. test:run had one isolated-pass rerun, 0 timeouts:
  npm-client shadow-recipe-v2-data-authority.contract.test.ts, case
  "esbuild transitive fresh supported", event-ledger equality at :391/:524.
  Raw first-run JSON: /private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-pr-check-TTI9ei/test-run.json.
  The JSON retains the assertion/stack but not actual/expected arrays; root
  cause remains unproven. No speculative source/test repair. Parity passed.
