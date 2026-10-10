# Observed environment/tool differences — I10

[Catalog](agent-eval-operation-catalog.json.gz): exact calls/arguments/results,
lane/version/source/hash, original outcome, recovery and impact/unknown.
Natural comparison, pilot, adaptive search, directed probes and unverified
contexts separate. Original scores unchanged.

| Evidence | Natural operations | Reported errors | Nonempty traces |
|---|---:|---:|---:|
| Accepted eval-v16 |1095|620|72|
| Accepted pilot-v4 |406|52|48|
| Interrupted boundary v1/v2 |210/145|81/64|17/12|
| Stopped v3 async1/2 |48/44|21/15|4/4|
| Fresh exploration v4 |306|123|18|
| Frozen confirmation v1 |388|148|28|

No duplicate/unlinked operations in each source cohort. Pilot source pointers
verify original compressed trace/bundle plus named parsed entries; raw cohorts
verify original trace SHA. Empty setup traces retained: comparison24/pilot24/
confirmation4; fresh exploration2 originating setup records remain in reports.

Primary errors:566 tool validation, not proof an executable ran.39 passing
trials contain obstacles;13 later exact-operation successes establish changed
context, not causal recovery. New exploration/confirmation add93/116 validation
errors. Unresolved classifications remain explicit unknown, exact results retained.

| Difference | Actual evidence | Effect/limit |
|---|---|---|
| python3/curl/sed/jq |36 directed calls via both public Rifty hosts/native Pi; browser exit127, native versions reported|Availability difference; no automatic task failure. Native comparison has9 actual Python commands.|
| python alias |Absent also in measured native host|Alias absence does not mean Python3 absent.|
| Node/fs/pipes |Directed public tools work across all3hosts|Measured alternatives, no universal compatibility claim.|
| execFileSync |Absent/TypeError bothRiftyhosts; native works|Existing runtime-js/node-builtins-loud-stub-capability-gaps; measured API gap.|
| Quoted heredoc/command substitution |Exact natural command/body replay fails bothRiftyhosts, works native|12 directed operations; direct-write recovers identical body SHA/all3final appjudgesPASS. Historical task impactunknown; existing shell-script-support-surface.|
| Node CLI --test/module-eval |Natural public Rifty calls retain bad-option/NotImplemented results|Flag/eval surface differs; successful task may use another operation. No automatic runtime expansion.|
| Tool validation |Pi/Rifty tool schema rejection before executor|Model/tool protocol interaction; not Node incompatibility.|
| Home/git/listen policies |Native Codex failed operations retained, including passing trials|Native context restricted too; not an unrestricted oracle.|
| Supplied/installed locks |Same supplied input hashes; actual source controls96:48Rifty rewrites/48native preserved|Installed graphs differ, never claimed identical.|
| esbuild/esbuild-wasm bin |BothRifty setup fails before model/reference via bin-collision-reify; native working refsPASS|Reproduced pinned-stack installation boundary; existing npm-11-bin-reify-authority. Not WASM execution impossibility.|

Outer producer Node24.16.0 differs from reported browser worker identity24.0.0.
Directed native Python3.9.6/curl8.7.1/jq1.7.1 captured by commands. Raw versions
per cohort/lane retained; no assumed cross-host equality.

Directed recovery body:
3493cc7d3050953e3a04ebdb1057fc6f7decba8e5e5daa50b799ab68b2c94768.
24 source files retained; intervention confirms directed recovery only.
Scripted external-provider probes are not model-quality trials.

Search/test/lint nonzero, patch mismatch, authoring/API-result errors, DNS/path,
policy and unknown distinguishable. Later success alone never proves a repair
caused a pass. Runtime gaps measured/catalogued; this unit adds no runtime feature.

Raw catalog/source audits/probes:
agent-eval-operation-catalog-evidence.json.gz; immutable canonical comparison/
pilot/search reports under tools/agent-bench/reports/summaries.
