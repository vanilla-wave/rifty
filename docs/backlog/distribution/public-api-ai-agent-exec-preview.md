---
area: distribution
status: draft
title: Residual AI-agent sandbox exec streaming + preview URL API
created: 2026-06-12
why: ADR-0131 landed only public FS read/write; agent contract still needs streamed exec results and a normalized preview URL surface
user_story: As a dev embedding rifty as my AI-agent backend, I want `sandbox.exec()` to stream `{ stdout, stderr, exitCode }` and hand me a normalized preview URL, but today the public SDK only offers `runtime.eval()` plus events — no command-shaped streamed exec, and preview wiring stays SW/host-route specific.
sources: [docs/research/open-webcontainers-alternative-2026-06.md, ADR-0071, ADR-0131, ADR-0048, ADR-0123, https://github.com/vanilla-wave/rifty/issues/326, docs/backlog/distribution/reference/product-integration-issue-triage.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts]
---

## Context

AI-agent sandbox consumers expect command-scoped output and completion. At
`2c7f9bbf4`, no-COI SDK runBin returns an exit code, but stdout/stderr remain global
and no operation stop is exposed. #326 adds a concrete product Stop → next-action
scenario. It belongs here rather than in a duplicate execution item.

The older preview claim is partly stale: ToolchainSandbox.startBin already returns
port/previewUrl and mounts the preview bridge. Generic-runtime preview remains a
separate question; #326 does not request rebuilding the no-COI preview API.

## Question

Expose invocation-scoped output, failure/completion and stop settlement, and
compose the existing Shell with project-root/write/execution policy. Preserve
#326's requirements: stopped work settles before the next action; late frames
cannot cross runs; cancellation does not imply rollback; worker replacement and
unacknowledged writes are explicit; readonly paths agree with file tools; hosts
can forbid background jobs. Browser proof includes failed → successful run and
cancellation during a filesystem mutation.

Workbench stop and Shell.signal are reusable mechanisms, not SDK proof. No-COI
shares one event loop; a blocked synchronous guest cannot receive a stop message.
Shell's default abort path may detach an unfinished handler. Current SDK restart
tracks public writeFile calls, not all guest-command mutations. Resolve these
facts through the existing command/recovery owners before choosing the interface.

## Options or Next

- Decide `sandbox.exec()` shape, cancellation, stdin, cwd/env, and event ordering.
- Decide preview URL normalization over the existing SW preview owner routing.
- Proposed iteration 2 groups #326 with `no-coi-project-files.md` (#325) for shared
  path/mutation/recovery semantics. Distinct API obligations remain visible;
  whole-sandbox snapshot/fork stays separate.

## Decisions

- 2026-09-10: user requested assessment/grouping only; this remains draft. Two-iteration grouping is an agent recommendation.
- Model providers, prompts, tool schemas and Stop UI stay in the host (#326).
- Worker termination may be needed for blocked guest code; no rollback or transparent state-preservation promise is inferred.

## Reversibility

IRREVERSIBLE when taken up — expands public `Sandbox` API. Needs its own ADR.
