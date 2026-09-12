# +chat preparation and proof

BASE: no-COI Final+GREEN `1989bdfca0dbb50ee9078a7a94c16b3553c61851`.
Authority: accepted goal I2–I5/I8 and unchanged source/FIT frontier; ADR-0427.
One UI, no Vibe layout. Native Pi/Workbench remain the source of behavior.

## Material assumptions

- PR-111 `App.tsx` conditionally mounts AiChatPanel; its onCleanup disposes the
  session. Close therefore stops/clears; Stop retains; Reset does not revert files.
  Applying settings explicitly creates a new conversation. No inherited secret
  persistence: user now permits persistence only for endpoint/model.
- PlaygroundTerminalUi is the existing visible run/Stop/busy owner. It will
  adopt a public terminal and run agent commands through its ordinary runLine.
  Native terminal output drives UI and trace; no second shell/registry.
- Current selected preview URL/frame is provided explicitly; no URL synthesis.
- Limits remain core defaults and can be changed in memory; benchmark can use
  those ordinary controls. Private hooks seed files, export and report metadata;
  they never send a prompt around the real chat input.

## RED carrier

`RIFTY_PLAYGROUND_PORT=5287 pnpm exec playwright test --project=chromium-heavy
--workers=1 tests/e2e/ai-mode.spec.ts`.

Real Playground/Workbench/React/terminal/preview, HTTP model-only script. Five
scenarios cover visible streaming edit/build, settings/reset/reload, provider
error/Stop/close/switch, storage/network/budget faults, and opt-in bench hooks.
The first required +chat action is absent on BASE; no product implementation
or placeholder UI precedes Contract+RED.

- Initial attempt used template id react-vite as a UI tile id; the existing
  React e2e and presets.ts identify the real tile as real-vite. Cancelled that
  selector wait; an overlapping second attempt was immediately cancelled too.
  Neither supplied product evidence. Removed serial fail-fast so every case runs.
- `/tmp/pr333-ai-ui-red3.log`: five intended missing-+chat assertion failures
  (each bounded at 1500ms), zero whole-test timeouts; each reached its real
  starter. No import/boot failures. Backlog/refs gates PASS. Keyboard Enter is
  the first scenario's send action; implementation and GREEN remain.

Live acceptance uses the user's running no-auth codex-proxy after deterministic
UI proof; record model, actual prompt, observed edit/build/preview and trace.
