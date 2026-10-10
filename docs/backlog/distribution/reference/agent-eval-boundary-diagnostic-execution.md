# Boundary execution — existing CLI only

No new phase/selection wrapper required. Use existing `agent-bench plan`, `run`,
`controls`, `report`; freeze declared selection/provenance before each fresh
series. Source admission11c0 accepted; diagnostic ready commit precedes model calls.

Exploration: full boundary-v1, allfourorigins, runs1 →32 model trials. Save
resolved plan and exact protocol under a fresh ignored .cache/pr341 root.
Confirmation: freeze one step per fourfamilies with observed rationale. For each
step existing CLI controls/reference runs1/all →4 controls, then run runs2/all
→8 models. Four independent family series:16 references+32 models. All outputs
fresh; preserve unstarted declarations/partial runner reports on interruption.

Exact invocation pattern:

```sh
pnpm agent-bench plan --suite boundary-v1 --config tools/agent-bench/configs/pilot-comparison.json --runs 1 --lane all
pnpm agent-bench run --suite boundary-v1 --config tools/agent-bench/configs/pilot-comparison.json --runs 1 --lane all --output <fresh-exploration>/models
pnpm agent-bench controls --suite boundary-v1 --config tools/agent-bench/configs/pilot-comparison.json --task <frozen-step> --control reference --runs 1 --lane all --output <fresh-confirmation>/<family>/reference
pnpm agent-bench run --suite boundary-v1 --config tools/agent-bench/configs/pilot-comparison.json --task <frozen-step> --runs 2 --lane all --output <fresh-confirmation>/<family>/models
pnpm agent-bench report <retained-series>
```

No untracked prototype is required for delivery. Paid experiments remain
separate from scripted directed tool probes and non-model source controls.
