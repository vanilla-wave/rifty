# Agent benchmark

Private diagnostic harness; never a paid CI lane. Same five tasks/model/common Pi
policy, three cold runs per supported lane by default. Tool/context differences
remain explicit; a delta is not automatically a runtime defect.

```sh
pnpm agent-bench run --mock-model --runs 1 --output /tmp/agent-smoke
pnpm agent-bench run --config /tmp/agent-endpoint.json --output /tmp/agent-live
pnpm agent-bench report /tmp/agent-live
```

Config (no-auth example):

```json
{
  "endpoint": { "baseUrl": "http://127.0.0.1:10530/v1", "model": "gpt-5.6-sol" },
  "limits": { "maxToolCalls": 40, "runTimeoutMs": 600000 }
}
```

Optional `endpoint.envKey` names an existing key environment variable; the value
never goes in config. Keyed runs omit raw Playwright traces/screenshots (these
can contain provider errors verbatim); textual artifacts are redacted. Default
playground port5289; override `playgroundPort` in config.

`--lane all|rifty|rifty-no-coi|local-reference`, `--task <slug>`, `--runs N`.
Tasks: fix-date-sort, add-search, url-filters, new-issue-form, node-endpoint.
Node control is explicitly excluded from rifty-no-coi; full default matrix42 runs.

- rifty: real launcher/+chat/settings/prompt entry, visible Agent terminal,
  editor/SCM/preview. Benchmark hooks only seed/task metadata/export. Ordinary
  workspace archives capture baseline/final bytes, including changes an agent commits.
- rifty-no-coi: SDK/agent installed from first-party tarballs in an external
  consumer; real installed dependency tarballs supply pinned packages unavailable
  from a registry. Shipped runtime assets, no source aliases or COI headers.
  Public project files/commands; host starts resident Vite only after agent work.
- local-reference: fresh native npm/Node project, pinned Pi CLI0.85.1. Public
  extension hooks remove auth when omitted, admit tool budgets and abort deadlines.
  Native tools remain read/bash/edit/write; full actual provider prompts recorded.
  Project lives outside the checkout even when reports live inside it; native
  children omit inherited `NODE_PATH`. The retained workspace path is in the report.

Smoke model reads the actual package.json and stops. Planted defects remain:
`agentStatus: done` + `outcome: fail` is the expected baseline, with identical
common judge evidence across lanes. Smoke success proves execution, not repair.

Each run retains transcript/events/provider requests, usage, elapsed time, tool
count, terminal tail, actual before/after file trees (including dependency locks), file diff, judge probes, browser trace/screenshot
when keyless. Header records source revision/dirty state and native/browser/Pi versions. JSON/Markdown distinguish budget-exceeded from ordinary failure.
Assign `failureClass` and `note` manually in report.json, then regenerate Markdown;
existing assignments survive. Classes: agent, rifty-runtime, rifty-tooling,
ai-mode-ux, provider, task-bad. Unclassified remains null. Failed setup/judging
retains its stage/error and previously completed records.

Validation (serialized; heavy browser runs must not overlap):

```sh
pnpm exec playwright test --config tools/agent-bench/playwright.config.ts
pnpm exec tsx tools/agent-bench/tests/native-judge-controls.ts
```

The external smoke observer checks28 actual provider requests/14 tool replies,
shared policy text and common-judge actions inside real Playwright ZIPs. Positive
controls execute seven ordinary repaired React/Hono programs through the same
judges, including link entry and native required textarea variants.

[Live42-run diagnostic](reports/summaries/2026-09-13-gpt-5.6-sol/README.md):
original measurements, classified judge repairs, retained-source rechecks and traces.
