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

## IMPLEMENT and observed repairs

- UI Contract+RED @ d33b8de82 accepted by fresh /root/ui_contract_review:
  15/15 coverage; independent five RED plus native Pi/HTTP fixture PASS.
  Raw `ai-mode-chat-contract-red.json`; three GREEN concerns retained.
- Native UI-run cancellation during resize: `/tmp/pr333-ai-terminal-red.log`
  returned exit0 after abort. Passing the signal through runLine and checking it
  after resize prevents admission; `/tmp/pr333-ai-terminal-green.log` 1 PASS.
- `/tmp/pr333-ai-ui-green1.log`: 4/5 PASS; React edit/build/preview succeeded,
  opening main.tsx failed. Isolated `/tmp/pr333-ai-ui-editor-red.log` captured
  `Open failed: Project file /src/main.tsx changed while its editor document opened`.
  Root: cached immutable clean Document, newer mirror version. Fault class:
  poisoned-cache / owned in-process projection; no transport loss/dup/reorder.
  Sweep: public file and shell writes, opened/unopened models, pending user writes;
  existing mirror, writer FIFO, immutable SDK captures and editor write state.
- ADR-0430 repair: `/tmp/pr333-editor-owner-green1.log` 2/2 native Monaco + real
  public Workbench PASS (same clean model, zero write-back, exact next-save base;
  unpublished local bytes retain old CAS/conflict). No mocked editor/VFS/Worker.
  Full React UI scenario `/tmp/pr333-ai-ui-editor-green.log` PASS, 33s.
- Terminal differential `/tmp/pr333-ai-terminal-stream-red.log`: ordinary Enter
  renders UI_PART_DONE; agent trace stdout also UI_PART_DONE, but its terminal
  shows `> UI_PART` then `> _DONE`. ADR-0431 routes the agent through the existing
  terminal input lifetime and native backend; no manually inferred output/result.

- Editor revert-checks (real Monaco/Workbench, restored exactly after each):
  removing owner-origin suppression causes echoWrites=1/versionStable=false;
  removing unpublished-generation refusal removes the required CAS conflict;
  accepting a view-rejected Document likewise removes the required CAS conflict.
  All three fail their original behavioral assertions (not timeout/import):
  `/tmp/pr333-editor-mutant-{no-owner-echo-guard,overwrite-unpublished,accept-rejected-capture}.log`.
  Initial sandbox bind EPERM was infrastructure only; rerun used permitted local servers.
- Native terminal presentation GREEN: `/tmp/pr333-ai-terminal-stream-green.log`
  2/2 PASS (split stdout matches user Enter; Stop/close/next session).

- Expanded native results remain open across stream completion; native tool
  errors retain error styling. Settings apply after history, active close/switch,
  and exact terminal output lines pass. `/tmp/pr333-ai-ui-green-full.log` 5 PASS;
  two newly added expectations were corrected (JSON escaped newline, and cat's
  newline-free bytes), then `/tmp/pr333-ai-ui-green-final-two.log` 2 PASS. No
  product assertion was weakened. `/tmp/pr333-ai-native-final.log` 4 PASS.

## Live model findings and Vite repair

First live no-auth run: gpt-5.6-sol, 223.2s, done; actual file changes and build
succeeded but the independent DOM judge failed (no search input). Original
trace/output/transport in `/tmp/pr333-ai-live-before-preview-fix-*`.
The model's final success wording is not acceptance.

1. preview_fetch got a relative registry URL; new URL threw Invalid URL.
   `/tmp/pr333-ai-preview-url-red.log` reproduces using actual HTTP preview.
   UI resolves the supplied URL against the frame owner's document base before
   passing it to the browser adapter. `/tmp/pr333-ai-preview-check.log`: that
   scenario passes including HTTP source bytes. No generic preview policy changed.
2. Leaf React change: bytes landed, Vite sent hot update, transformed module
   contained the new input, DOM stayed old. `/tmp/pr333-ai-react-hmr-diagnosis.log`;
   raw HTTP responses `/tmp/pr333-hmr-module-{0,1,2,3}.js` show two equal Refresh
   runtimes at /@react-refresh and /@id//@react-refresh. The HTML preamble and
   component registered with different module identities.
3. Native Node/Vite/React oracle: same input edit before/after build, same
   document, one Refresh URL. `/tmp/pr333-react-hmr-native.log`; retained
   `ai-mode-react-hmr-native.json` and executable `ai-mode-react-hmr-oracle.mjs`
   (takes an installed current React starter directory; seed via the ordinary
   resolveBootstrapConfig mapping, npm install). The real upstream function
   itself yields /@id//@react-refresh at root /, normal URL at an ordinary root.
   No Node server or recursive watcher was opened at filesystem root.
4. Birth boundary/fault class: upstream Vite resolved-id→URL normalization /
   sibling-drift (duplicate module identity). It strips root.length even for /.
   Transport loss/dup/reorder, file-store divergence and stale transform bytes
   excluded by captured exact updated module and delivered HMR; they are not the
   birth boundary. Sweep: source, optimized-dependency and virtual module ids
   share this function. Node path/fs primitives are not the cause.
5. ADR-0433: exact registry acquisition patch preserves the slash only for root /.
   Ordinary roots unchanged; no React-specific rewrite/reload. Current Vite 7/8
   inputs inspected; recipe identity and standard snapshot producer carry it.
   `/tmp/pr333-ai-react-hmr-green.log`: real React input visible before/after
   build, document identity survives, one Refresh URL. Real tarball function
   plus acquisition tests: 96 PASS; added trusted-tree guard: final 90 PASS.
   Both new guard revert-checks fail their original assertions:
   `/tmp/pr333-vite-mutant-url-anchor.log` (missing/duplicate input accepted),
   `/tmp/pr333-vite-mutant-url-trust.log` (unprepared entry admitted). Restored.


## Final live acceptance

`node --import tsx /tmp/pr333-ai-live.mts` → `/tmp/pr333-ai-live.log`: PASS.
User's codex-proxy endpoint http://127.0.0.1:10530/v1, gpt-5.6-sol; 16 real
requests, zero Authorization headers, 35 tool results, 156.7s, status done.
Source edits → successful npm build → actual preview query/type/click → exported
trace and SCM. Independent UI judge: uppercase DARK + closed + Mara leaves
one expected issue; all three values and the rendered result survive reload.
Screenshot inspected at 1440×1000. Actual key-free exported bytes retained gzip
in ai-mode-chat-live-trace.json.gz; hash/config/transport/proof in
ai-mode-chat-live-proof.json; ai-mode-chat-live.png captures the result.

The preceding completed live run's supplementary judge used exact Status
label matching, but native label text is StatusAllopen… . Verified prefix
selection on that run's exact restored finalDiff and persisted test profile:
`/tmp/pr333-ai-resume-judge.log` PASS. It is not counted as the final live PASS;
the final fresh live run above independently repeated the complete journey.

Production artifact: `/tmp/pr333-ai-prod.log` PASS. Hashed agent/Pi chunks are
identified from real build source maps; cold IDE fetched none, +chat loaded
and ran real Pi against the external scripted HTTP model. Existing unit
regressions `/tmp/pr333-ai-ui-unit-regression.log`: 214 PASS. Full snapshot
producer `/tmp/pr333-ai-snapshots-bake.log` PASS, source/artifact check PASS.


## Remaining goal measurement

The live trace's native diagnostics report TS7016/7026 for react/jsx-runtime
and JSX intrinsic elements. No cause or Node-parity verdict is inferred from
those messages alone. The accepted I8 tsc/runtime-baseline measurement owns
checking the actual installed declaration tree versus the native lane; retained
in the goal map, not marked fixed or silently classified as an agent failure.

- Full gate isolated the single App source-composition pin failure: it required
  warmEditorStack's function body inline in App, while the unchanged helper was
  moved to playground-editor-warmup.ts for the file-size ratchet. Replaced the obsolete location pin with production network/DOM proof: before
  a project, EditorHost's actual hashed chunk is absent; choosing the starter
  fetches it and mounts Monaco. Source-grep allowance shrinks 40→39. Native
  editor boot/UI and full types also pass; product criteria unchanged.

- `/tmp/pr333-ai-prcheck-final.log`: all 25 checks PASS; test:run187.3s,
  parity61.2s, no isolated reruns. Production Monaco/agent lazy proof PASS.
- Packed consumer first attempt passed tarball install/typecheck/build, then
  refused missing original Rollup4.63.2 fixture selected by the fresh snapshot
  producer. Added original Rollup and same-version WASM companion responses,
  checked metadata URL/version and archive SHA512 against the produced lock.
  `/tmp/pr333-ai-rollup-fixture-capture.log`; no test acceptance was weakened.

- All five users of the extended original-tarball fixture retain their previous
  behavior: `/tmp/pr333-ai-fixture-regression.log`, 49 PASS. Existing ordinary
  and nested lock pins still select4.63.1; snapshot consumer selects its own
  new4.63.2 pin. Original fixture inputs were not edited.

- Final complete tree including original fixtures: packed consumer
  `/tmp/pr333-ai-packed-final.log` PASS167.5s; all25 checks in
  `/tmp/pr333-ai-delivery-check.log` PASS (test:run187.9s, parity61.4s;
  zero isolated reruns). Final source tree has no known UI acceptance residual;
  I8 and its explicit baseline measurement remain on the goal map.
