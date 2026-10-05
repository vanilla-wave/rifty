# Agent benchmark

Private diagnostic harness; never a paid CI lane. Same five tasks/model/common Pi
policy, three cold runs per supported lane by default. Tool/context differences
remain explicit; a delta is not automatically a runtime defect.

```sh
pnpm agent-bench plan --config tools/agent-bench/configs/gpt-6-luna.json
pnpm agent-bench run --mock-model --runs 1 --output /tmp/agent-smoke
pnpm agent-bench run --config /tmp/agent-endpoint.json --output /tmp/agent-live
pnpm agent-bench report /tmp/agent-live
pnpm agent-bench report /tmp/agent-live --compare /tmp/agent-baseline
```

Comparison requires identical endpoint/limits/task set and complete matching run identities.
`comparison.json`/`comparison.md` retain both headers and per-task/lane metric deltas.
Any lost pass exits1 after writing artifacts; ±1/3 is labelled within noise, still a regression.

Committed summaries (`reports/summaries/`) store every JSON artifact as gzip
`<name>.json.gz` (test-enforced); Markdown/screenshots stay plain. Report-written JSON gets
a normalized gzip header (mtime 0, OS byte 0x03); its deflate stream is identical for the
same zlib build, not proven across OS. Frozen `source-artifacts.json.gz` bundles keep
their measured bytes; manifest sizes/SHA256 are test-checked against committed files.
`report` reads either `<name>.json` or `<name>.json.gz`; a directory holding only
`report.json.gz` gets gzip report/comparison JSON back, fresh run directories stay plain.

Config (no-auth example):

```json
{
  "endpoint": {
    "id": "gpt-6-luna", "name": "GPT-6 Luna", "provider": "codex-proxy",
    "api": "openai-completions", "baseUrl": "http://127.0.0.1:10539/v1",
    "contextWindow": 1000000, "maxTokens": 8192, "reasoning": true,
    "input": ["text"], "thinking": "medium", "compat": { "supportsReasoningEffort": true },
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  },
  "limits": { "maxToolCalls": 40, "runTimeoutMs": 600000 }
}
```

The endpoint uses native pi Model fields; contextWindow/maxTokens are required.
Optional reasoning/input/thinking/compat default to false/text/off/empty. Temperature
and samplingParams (including top_p) are optional provider defaults; absent values
are not sent. All lanes receive the same declared entry. The checked-in
[local Luna config](configs/gpt-6-luna.json) is used for the goal baseline/re-run.

Optional `endpoint.envKey` names an existing key environment variable; the value
never goes in config. Runs with keys or model headers omit raw Playwright traces/screenshots (these
can contain provider errors verbatim); textual artifacts are redacted. JSON
numbers, protocol tags and generated artifact/provenance fields stay intact;
known credentials are masked in payload strings and dictionary keys. Metrics
use live events before masking in every lane. Default
playground port5289; override `playgroundPort` in config.

`--lane all|rifty|rifty-no-coi|local-reference|native-codex`, `--task <slug>`, `--runs N`.
Tasks: fix-date-sort, add-search, url-filters, new-issue-form, node-endpoint.
New series retain the selected no-COI Node control as an unsupported setup failure; full selected smoke matrix60 trials (four lanes; unconfigured Codex retains setup failures). Historical42-run reports retain their original exclusions.

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
when keyless. Header records source revision/dirty state and native/browser/Pi versions. JSON/Markdown distinguish budget-exceeded and context-exceeded from ordinary
failure, retaining the actual agent status. Input tokens include pi input plus
cacheRead/cacheWrite; output tokens use pi output. Counts derive from emitted
retry starts, successful compactions (including summary usage), repeated-call
notices and errored edit/validation tool results. Counters may overlap; manual
failure classification stays separate. Legacy reports show absent metrics as —.
Native compaction and agent-level retries are on; provider retries remain off.
Assign `failureClass` and `note` manually in report.json (committed summaries:
report.json.gz), then regenerate Markdown;
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


The no-COI lane imports the packed Vite consumer's `src/host.ts`; packing preserves
that relative import and resolves SDK/agent/Workbench from installed tarballs.
Defaults100 calls/600s match the reference host; explicit `limits` remain measured
inputs. Set `endpoint.textOnlyContent` for string-only message content. Optional
`noCoiPolicies` passes `{files,shell}` policy values to this same host (only the
no-COI lane); omitted means unrestricted. Reports record these values and comparison
rejects differing policy settings. Historical reports keep their original limits.

Scripted packed-host smoke (no model account):
`pnpm exec playwright test -c tools/agent-bench/playwright.config.ts reference-host.spec.ts`.

The default full packed-consumer CI lane runs this smoke too, including genuine
Vite iframe preview. SW registration occurs only when the benchmark requests
preview after the agent turn; the shared commands host remains SW-free.

## Local series through Codex

Codex operates the scripts: inspect `plan`, choose explicit config/task/lane/runs,
invoke `run`, follow START/END, inspect report/trace/diff/judge evidence, invoke
`report` to regenerate. The scripts own ordering/scoring; operator prose changes
neither judge nor score. `plan` validates without starting services or calling a
model. It records ordered identities, config, source revision/dirty-diff digest,
starting file/prompt/judge hashes and lockfile hash (null for legacy smoke starters).
The corpus pins its own installed lockfiles; legacy smoke is a separate control.

Output must be absent. An occupied directory throws before setup; config files
live outside that directory. Each run creates a new series and cold workspaces.
The initial report contains the entire resolved plan before service/browser
setup. SIGINT/SIGTERM stops the current work and keeps completed records; its
unfinished trial and unstarted work remain missing. Setup/cleanup failures retain
partial evidence and a series error. Completed records persist before teardown.
JSON is atomically replaced by the serial runner; `report` only regenerates the
Markdown view and never rewrites authoritative JSON or calls agents. A running
report after abrupt process death is visibly partial, never completed. No resume.

Before live execution, record selected matrix size, budgets and expected cost in
campaign protocol. Scripted model controls test plumbing, not coding quality.
Native Codex is a separate participant; the operating Codex session is not scored.

## Native Codex reference

Explicit config `"codex":{"model":"gpt-6.1-sol","reasoning":"low"}` enables native
execution; no paid default. `all` always selects four lanes; absent Codex config
retains each native-codex setup failure. `--mock-model` scripts only Pi's model
boundary; it never fabricates a Codex agent. Configure a real Codex reference
only for on-demand experiments, not scripted CI.

Native Pi/Codex share fresh native project/npm/git/server preparation and common
judges. Codex uses `exec --json`, fresh ephemeral session, ignored user config/rules,
project-doc byte limit0, workspace-write/automatic approval; actual CLI version,
model/reasoning, argv/events, initial source and final diff retained. Judge artifacts,
operator config/history and answers are outside the seeded project. Existing-task
real acceptance: `pnpm exec tsx tools/agent-bench/tests/codex-reference.ts` (paid,
on-demand, plus real1s deadline).

Completion needs exit0 and exactly one successful turn.completed/usage, no failed
turn or malformed JSONL. Incomplete streams remain unsuccessful with raw captured
text. Codex budgets cancel with SIGINT; live probe proves tool termination.
Tool limits cancel after an observed excess item, can overshoot; actual counts
remain untruncated. This differs from Pi's pre-dispatch admission. Native Codex
counters the CLI does not emit are marked unavailable/unknown; incomplete token
usage unknown. Before/after comparisons preserve unknown totals/deltas, never0.
Codex pass rates are separate references, never Pi model deltas.

Native capture uses Node streaming UTF-8 decoding; server logs append original
buffers, preserving multibyte boundaries. No separate process/evidence coordinator.

## Frozen project corpora

`plan/run --suite pilot-v1` selects six pinned pilot cases:2bugs/2features/2apps.
Both ms cases calibration; evaluation families disjoint. Legacy five-task smoke
stays separate. Loader validates source/prompt/judge hashes, v3 lock, seed paths
and card/split identity before execution. Full selected failures remain records.

`controls --suite pilot-v1 --control baseline|reference|partial|alternative`
uses the same four origins without model calls (`agentStatus:not-run`). Controls
validate task/judge behavior, never agent quality. Native Codex controls use real
native preparation/version, not a Codex turn. Reference patches/checks stay outside
agent-visible seed; command checks injected after the turn and execute in the
origin, no native rescue. Original upstream tests remain source evidence; common
semantic assertions do not claim original Tape/Mocha/nyc wrappers ran.

Directed physical receipt/judge-substitution proof:
`pnpm exec playwright test -c tools/agent-bench/playwright.config.ts trusted-origin.fault.spec.ts`.
Reference matrix:
`pnpm exec playwright test -c tools/agent-bench/playwright.config.ts corpus-controls.spec.ts`.

Native previews restart before judging updated programs; snapshots precede
trusted checks/preview restrictions. Browser app checks use actual Page/Frame
interactions with explicit accessible task behavior, including alternate export.

App oracle structure regression (no model):
`pnpm exec tsx tools/agent-bench/tests/app-structure-controls.ts`.
Real altered programs use saved-note links/section, searchbox, article/bold tag
and CSV output; correct alternatives pass, lost public requirements fail.
Historical controls retain their old judge hashes/outcomes; pilot grading
corrections happen before any comparative quality campaign.

## Fixed-corpus report

Current series write `statistics.json` (gzip in committed summaries) plus Markdown
from unchanged authoritative JSON. Legacy reports without a resolved matrix keep
their file set; selected matrix/input compatibility unknown, no new quality estimate.
Per-task CP95% intervals assume iid repeats conditional on fixed settings;
Bonferroni finite-cell bands bound equal-task groups/Pi deltas. Provider/cache
correlation may violate iid. Wide intervals/small finite corpus never equality or
general task-population proof. Native Codex separate; unavailable counters unknown.
Calibration/evaluation/smoke/control evidence separated; repeats do not add families.
Missing attempts point unavailable, retained setup/provider/judge/budget/context
failures stay selected. `--compare` rejects changed input/lock/prompt/judge/selection
identity or partial series; intentional source versions remain visible.
Attempt timestamps and before-tree/lock hashes expose actual preparation/agent/
judging; legacy absent timestamps unobserved. Artifact links resolve to actual
files or retained bundles. Recorded elapsed is agent time when started, preparation
time on setup failure; not total campaign wall.

Corrected comparative suite: `--suite pilot-v2`. Same six families/project inputs;
new `csv-workflow-v2`/`markdown-notes-v2` case IDs preserve the originalv1 files.
Pilot-v1 has a verified generic-caption oracle defect; historical scores retained,
not valid full coding-quality evidence. Semantic role/name discovery accepts
descriptions/common domain synonyms, separates editable source from readonly
output; functional data assertions unchanged. `caption-controls.fault.spec.ts`
checks real variants/negatives and four-origin captions plus unchanged actual
programme2 in its original COI. Corpus and shared-support fingerprints visible.
