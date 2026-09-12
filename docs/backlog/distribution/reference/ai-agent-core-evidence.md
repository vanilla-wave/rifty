# Agent core evidence

Baseline main `acf594da9`; accepted goal FIT `5d46fb9debeb067a014bbdc3ac464dbf4a665fe4`.
Oracle: `ai-agent-pi-pickup-evidence.md`, executable `ai-agent-pi-oracle.mjs`.
Seven Node and Chromium cases pass (custom prompt/follow-up recovery, OpenAI
recovery, abort with throw/structured result, ignored abort, replay declaration).

## Initial RED

2026-09-12, Node 24.16.0, Playwright 1.60.0, real browser Workbench/Workers.

```
pnpm --filter @riftydev/agent typecheck
PASS
pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts
5 failed, 0 timeouts (1.1s / 687ms / 488ms / 490ms / 480ms)
All: NotImplementedError: Not implemented: agent.workbench-host
```

The host boots before importing the agent proof; no import/type failure or
mocked Workbench. Only the model's HTTP streaming responses are scripted.
Public API scaffold intentionally throws pending Contract+RED; no implementation.

## Complete preparation RED

```
pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts tests/browser-unit/agent-core-snapshot.spec.ts
12 failed, 0 timeouts
11: NotImplementedError: agent.workbench-host
1: NotImplementedError: agent.browser-preview
```

Includes custom stream/Stop, wall-clock cancellation, CAS conflict, UTF-8 cap,
real companion diagnostics, real iframe and real snapshot-only Vite
build/preview setup. Earlier companion fixture lacked TypeScript and initially
hit Vite's late optimizer reload; fixed the fixture to the installed TypeScript
starter and predeclared lazy Pi optimizer entries. Final run reaches only the
intended unimplemented API errors. A prior in-flight trace archive failure is
not counted as evidence; the final stable-tree run above replaces it.

Packed packaging proof repeats the same snapshot scenario after implementation;
no different reference semantics are inferred from package filenames.

## Host facts

- ProjectTerminal: attach before run; use owner exitCode and await run.close()
  to release its slot. ProjectFiles CAS preserves the exact read version.
- Plain ProjectSession has no diagnostics/SCM; companion supplied explicitly.
- PreviewHandle only gives URL. DOM tools need the host's real frame.
- Packed snapshot-only Workbench is the fixed-deps/no-registry/HMR carrier;
  no-COI full resident cycle and replaced Worker proof stay in its linked child.

## HMR reference correction (PR-4)

The first GREEN run passed 12/12. Strengthening the review's HMR concern with
an unconditional same-document assertion across syntax-error recovery failed
(13/14); this extra assertion was not in the reviewed RED contract.

Real Node probe, Vite 7.3.6 / Node 24.16.0, Chromium: install exact Vite, serve
the same self-accepting module; mark document, write invalid syntax, run failed
build, fix module, run successful build; then mark document and make a valid edit.
Executed `node /tmp/pr333-vite-oracle/probe.mjs`:

```
{"node":"v24.16.0","vite":"7.3.6","badBuild":1,"afterRepair":null,"afterValidEdit":"after-repair"}
```

Correct criterion: syntax-error recovery reloads, a subsequent valid agent edit
updates the same document. Both are asserted; original build/file/preview
assertions remain. Packed proof also asserts the separate valid-write HMR
transition. No runtime criterion was weakened to hide a product failure.

## Patch validation

Quarry parser RED: four defects against real `git apply` 2.50.1 — insertion
EOF newline, partial deletion removing unmentioned content, replacing an
unterminated last line, earlier hunk offsets selecting the wrong identical line.
Five unit cases now pass. Insertion beyond EOF is allowed by git and appends a
terminated line: an initial throw hypothesis was disproven before the fix; the
corrected oracle still failed the quarry's bytes.

`diff` 8.0.4 (already transitive via Pi) was probed as a simpler replacement:
its applyPatch adds blank lines for that insertion and returns residual text
for partial deletion. Rejected by those cases; no new dependency.

## Live proxy repair

User supplied `~/codex-proxy.mjs` and authorized repairs. Actual tool-call SSE
ended with `stop` and usage 0/0/0. Targeted finish-event probe showed undefined
finishReason and empty usage details. Bundled OpenAIResponsesLanguageModel
returns V2 string/flat fields but declared V3; SDK skipped its existing V2→V3
adapter. Changed instance/factory declarations to V2; no hand-mapped finish/usage.
Reviewable patch: `codex-proxy-v2-provider.patch`.

Executed `/tmp/pr333-proxy-check.mjs` on original: RED `stop` vs `tool_calls`.
Candidate and corrected user script: PASS `tool_calls`, prompt/completion/total
57/21/78; arguments preserved. `node --check` PASS. Fresh independent
`/root/proxy_final_review`: PASS, no findings; inspected generate/stream paths
and preserved RED/GREEN SSE. Raw `/v1/responses` uses a separate client.

## GREEN so far

`pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts tests/browser-unit/agent-core-snapshot.spec.ts`:
14 passed (16.1s), including the four review concerns. Patch unit suite 5 PASS;
agent typecheck/build and architecture gate PASS. Packed/global checks follow.

## Packed consumer preparation

Initial packed install RED: `Offline consumer requires two
@smithy/node-http-handler versions: 4.7.3, 4.12.1`. The former harness flattened
every dependency to one root tarball. It now captures name+version and serves
those real tarballs through its existing loopback registry; native npm resolves
the declared graph. First-party roots remain file tarballs; every HTTP lock
resolution must match a served version and integrity, and links remain rejected.
This changes the fixture's local install transport, not runtime acquisition or
acceptance. No registry package manifest is rewritten to force a graph (PR-4).

The next packed run passed native install, strict TypeScript/build and agent
build/HMR actions, then hit the fixture's own unsafe HMR callback:
`Cannot read properties of undefined (reading 'message')`. Real Node Vite 7.3.6
reproduced exactly via `/tmp/pr333-vite-oracle/dependency-probe.mjs` when the
dependency was deliberately made syntactically invalid. Guard the optional HMR
module in that fixture; the existing zero-browser-error assertion stays intact.

Final full packed run: `node tests/integration/workbench-packed-consumer.mjs --keep`
PASS — 16 first-party + 177 external tarballs; strict TypeScript/build, fresh
Chromium; agent failed-build/repair and valid-write HMR; all existing Workbench,
snapshot/scoped-preview/no-COI baselines retained. Runtime snapshot-only journey:
zero registry/Eddy acquisition. No consumer bundler alias added.

First `pnpm pr:check`: 24/25 passed, including test:run (193.2s) and parity
(61.6s); only formatting/style in the retained probe artifact failed. Fixed
without changing oracle assertions; full lint now passes (warnings only).

Second full `pnpm pr:check`: 25/25 PASS (test:run 191.6s, parity 61.7s).
Subsequent native-result check found two preparation gaps: a successful consumer
tool returning domain `{status:'failed'}` was incorrectly flagged as tool failure;
a nonzero shell exit's host status was rewritten. Real Pi 0.85.1 keeps the domain
record successful. Two new browser assertions RED, then PASS after internal
failure classification was separated from user/host data. Full browser set now
15 PASS (16.4s); host outcomes remain verbatim. Final gate re-run follows.

Additional executed recovery REDs: partial streamed tool proposals produced an
orphan tool result on continuation; synthetic results followed `agent_end`;
completion-callback exports lacked timings. The live supplied proxy rejected
the orphan with `No tool call found for function call output with call_id
partial-call`. Normalization now precedes agent_end, covers only admitted
assistant batches, and preserves current-run end-message scope; timings precede
the terminal status. Browser assertions prove each transition.

UTF-8 RED: TextDecoder's default dropped the BOM outside an exact edit and at
the capped head. Real Node 24.16.0 read/replace/write retains bytes
`[239,187,191,98,101,116,97]`; both decoders now preserve it. Git 2.50.1's quoted
UTF-8 filename output also drove a RED: decode C/octal paths rather than create
a different literal name. Mixed binary/text patches are explicitly refused,
consistent with text-only tools. Patch suite 7 PASS; browser suite 17 PASS.

Delivery gate: `pnpm pr:check` 25/25 PASS, test:run 188.7s, parity 61.3s.
No test:run isolation rerun was needed. Final independent review follows this
committed tree; remaining goal children stay linked.
