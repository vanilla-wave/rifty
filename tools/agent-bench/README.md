# Agent benchmark

Private local benchmark; four real lanes, frozen corpora, three fresh trials by
default. The original five tasks are the smoke set. Tool/context differences
remain explicit; a delta is not a runtime-only cause.

[Current qualified eval-v18 reference](reports/summaries/2026-10-15-eval-v18-corrected/README.md):
fresh 96 trials, 64 PASS / 32 FAIL; COI 10, no-COI 14, native Pi 19, native Codex 21
of 24; every FAIL classified; two setup failures; no clean model-quality or
runtime-only causal claim. Its booking/expense rows are oracle-qualified: the
record-observation judge engine that graded them was retired (ADR-0535) and those
cases are not in the tree. Earlier campaigns (pilot v1–v4, eval v1–v17, boundary
studies) were restarted on judge/setup/proxy defects and are not retained in git;
the v18 README records their history. Committed summaries carry the text core only
(ADR-0532): report, statistics, summary, README; traces, screenshot streams and
workspace archives stay in the local run directory.

```sh
pnpm agent-bench plan --suite core-v1 --config tools/agent-bench/configs/pilot-comparison.json
pnpm agent-bench run --suite core-v1 --config tools/agent-bench/configs/pilot-comparison.json --output /tmp/agent-core
pnpm agent-bench report /tmp/agent-core
pnpm agent-bench report /tmp/agent-core --compare /tmp/agent-core-baseline
pnpm agent-bench run --mock-model --runs 1 --output /tmp/agent-smoke   # legacy five-task smoke
```

`--lane all|rifty|rifty-no-coi|local-reference|native-codex`, `--task <slug>`,
`--runs N`, `--suite core-v1|boundary-v1`. Without `--suite` the legacy smoke tasks
run: fix-date-sort, add-search, url-filters, new-issue-form, node-endpoint.

## Corpora

`core-v1` — six frozen cases with unchanged eval-v18 bytes: `ms-negative`, `ms-weeks`
(calibration), `stringify-boxed`, `queue-clear` (library bug/feature; private
command judges executed in each origin, ADR-0506) and the two app cases
`csv-workflow-v5` (React/TS, ADR-0509/0513/0515) and `markdown-notes-v4` (vanilla,
ADR-0510/0514) whose browser judges were calibrated on real programmes.
`boundary-v1` — eight engineering/boundary cases on the installed starters with
command judges and starter build/boot regression.

Loader validates source/prompt/judge hashes, v3 lock, seed paths and card identity
before execution; the judge fingerprint covers the judge's whole relative-import
closure (`corpus-judge-closure.test.ts`). Seeds exclude controls/private checks.
`controls --suite <s> --control baseline|reference|partial|alternative` exercises the
four origins without model calls (`agentStatus: not-run`); controls validate
task/judge behaviour, never agent quality.

New app cases follow ADR-0535: the prompt states the module API and the accessible
names the smoke touches, the judge is a test run in the origin, and ≥3 correct / ≥3
wrong implementations are committed before freeze —
`docs/backlog/distribution/agent-bench-contract-first-corpus.md`.

Freeze selection/config/source/working references before models. Choose an unused
playgroundPort; record its transport change. Do not resume interrupted series,
regrade history, tune prompts to rescue failures or infer runtime cause from a
native pass. An all-pass resource bound is not an absolute ceiling.

## Config

```json
{
  "endpoint": {
    "id": "gpt-6-luna", "name": "GPT-6 Luna", "provider": "codex-proxy",
    "api": "openai-completions", "baseUrl": "http://127.0.0.1:10530/v1",
    "contextWindow": 1000000, "maxTokens": 8192, "reasoning": true,
    "input": ["text"], "thinking": "medium", "compat": { "supportsReasoningEffort": true },
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  },
  "limits": { "maxToolCalls": 100, "runTimeoutMs": 600000 },
  "codex": { "model": "gpt-6.1-sol", "reasoning": "low" }
}
```

The endpoint uses native pi Model fields; contextWindow/maxTokens are required.
Optional reasoning/input/thinking/compat default to false/text/off/empty.
Temperature/samplingParams are optional provider defaults; absent values are not
sent. All lanes receive the same declared entry. `endpoint.envKey` names an existing
key environment variable; the value never goes in config. Runs with keys or model
headers omit raw Playwright traces/screenshots; textual artifacts are redacted,
JSON numbers/protocol tags/provenance intact. Default playground port 5289;
override `playgroundPort`. Optional `noCoiPolicies` passes `{files,shell}` to the
no-COI host; reports record it and comparison rejects differing values.
`codex` enables the native Codex lane (no paid default); absent config retains each
native-codex setup failure as a record.

## Lanes

- rifty: real launcher/+chat/settings/prompt entry, visible Agent terminal,
  editor/SCM/preview. Benchmark hooks only seed/task metadata/export.
- rifty-no-coi: SDK/agent installed from first-party tarballs in an external
  consumer; real installed dependency tarballs supply pinned packages. Shipped
  runtime assets, no source aliases or COI headers; host starts resident Vite only
  after agent work.
- local-reference: fresh native npm/Node project, pinned Pi CLI 0.85.1, native
  read/bash/edit/write tools; project lives outside the checkout; native children
  omit inherited `NODE_PATH`.
- native-codex: `codex exec --json`, fresh ephemeral session, ignored user
  config/rules, project-doc byte limit 0, workspace-write/automatic approval.
  Completion needs exit 0 and exactly one successful `turn.completed`; budgets cancel
  with SIGINT after an observed excess item; counters the CLI does not emit are
  unknown, never 0. Codex pass rates are separate references, never Pi deltas.

Native Pi/Codex share fresh native project/npm/git/server preparation and common
judges; command judges are injected after the turn and execute in the origin.

## Runs, reports, comparison

`plan` validates without starting services: ordered identities, config, source
revision/dirty-diff digest, file/prompt/judge hashes and lockfile hash. Output must
be absent; each run creates a new series and cold workspaces. SIGINT/SIGTERM keeps
completed records; the unfinished trial stays missing. No resume. `report`
regenerates Markdown from unchanged JSON and never calls agents; `statistics.json`
carries per-task CP95 % intervals (iid conditional on fixed settings; provider/cache
correlation may violate it) and Bonferroni bands. `--compare` requires identical
endpoint/limits/task set, input/lock/prompt/judge identity and complete series; any
lost pass exits 1 after writing artifacts.

Each run retains transcript/events/provider requests, usage, elapsed time, tool
count, terminal tail, before/after file trees (including locks), diff, judge probes
and — keyless — browser trace/screenshot in the local run directory. Outcomes:
pass, fail, budget-exceeded, context-exceeded. Assign `failureClass`/`note` manually
in a fresh `report.json` before freezing (classes: agent, rifty-runtime,
rifty-tooling, native-tooling, ai-mode-ux, provider, task-bad; `none` for PASS,
`unisolated` for an unexplained failure), then regenerate Markdown. Frozen reports
stay immutable; later classifications use a linked sidecar.

Committed summaries store JSON as gzip `<name>.json.gz` (test-enforced, normalized
header, ≤8 MiB, no `browser.*`/zip/parts); `report` reads plain or gzip.

## Validation (no model)

```sh
pnpm exec vitest run tools/agent-bench/src
pnpm exec playwright test --config tools/agent-bench/playwright.config.ts
pnpm exec tsx tools/agent-bench/tests/native-judge-controls.ts
pnpm exec tsx tools/agent-bench/tests/app-structure-controls.ts
node --import tsx tools/agent-bench/tests/csv-export-toggle-controls.ts
node --import tsx tools/agent-bench/tests/notes-entry-controls.ts
```

Playwright specs are on-demand (serialized; heavy browser runs must not overlap):
`contract.spec.ts` external smoke observer, `reference-host.spec.ts` packed-host
smoke (also in the default packed-consumer CI lane), `corpus-controls.spec.ts`
four-origin reference matrix on `core-v1`, `trusted-origin.fault.spec.ts`
judge-substitution proof, `series-interruption.spec.ts`, `editable-control-names`/
`native-input-roles`/`notes-entry-controls.fault` judge-helper specs. The
`*-origin-controls.ts` scripts replay captured programmes through all four origins.
Real Codex acceptance: `pnpm exec tsx tools/agent-bench/tests/codex-reference.ts`
(paid, on-demand).

Smoke model reads the actual package.json and stops; planted defects remain:
`agentStatus: done` + `outcome: fail` is the expected baseline. Smoke success
proves execution, not repair.
