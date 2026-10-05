# Comparison preparation

Authority: unchanged ready goal I2/I3/I4/I5/I7/I8/I9 + original user/refine
sources; pilot-to-expansion route accepted, no threshold/equality/population claim.
Existing report/series remains owner; native Codex distinct/unknown telemetry.

## Reference

Primary NIST exact binomial and Bonferroni union docs read2026-10-05 (ADR-0507).
Independent Python Decimal60/integer math.comb CDF oracle/bisection, not shipped
bench implementation; alpha.1 N20/k4 lower0.07135388430861818,
upper0.40102811733197464; NIST displayed0.071354/0.401029 within1e-6.
Alpha.05 same20/4 lower0.05733399705003276,
upper0.43661400299666837 (nearestJSdouble0.43661400299666836).
Endpoints analytic0/n:[0,1-(alpha/2)^(1/n)],n/n:[(alpha/2)^(1/n),1].
No statistical dependency installed; scipy import absent, no fallback fabricated.

Command: Python3 stdlib Decimal(getcontext.prec60), sum integercomb(n,j)*p^j*
(1-p)^(n-j);220 bisections solveCDF(k-1)=1-alpha/2 andCDF(k)=alpha/2.
Oracle90% crosschecked primaryNIST;95% expected values compiled into RED.

## RED

`pnpm exec vitest run tools/agent-bench/src/statistics-report.test.ts`:
11/11 behavioral RED (8.36s).4cases reportCLI succeeds but statistics.json absent;
2invalid duplicate/outside cases accepted exit0;5same-task files/lock/prompt/
judge/split drift comparisons accepted exit0. No import failure; fixture endpoint
thinking/type and numericliteral lint repaired; package typecheck pass.
SyntheticJSON external input tests arithmetic only, never measured agent quality.
Expected future math/proportions/groups/missing/nativeunknown/nonquality assertions
remain inside these entrypoint REDs; independent final must inspect deeper probes.

## Before measurement

`agent-eval-comparison-protocol.md`: selected72=6cases×4origins×3fresh repeats,
100calls/600s;Luna same entry/medium, nativeCodexgpt6.1/low labelled separately.
48 expected agents and24 known browser-library setup failures; full matrix primary.
Both currentapp references all4 pass, secondary compatible view fixed before calls.
Old 15/9 and all new16/8 controls/raw history retained, no success-based pruning.
Expected time/usage extrapolates historicalPi median and realCodex trial; no
billing/guaranteedwall claim. Actual costs/usage/failed stages retained after run.
Per-case authoring effort/observed reference setup/check cost saved JSONgzip;
manualauthoring duration uninstrumented/unknown, not retrospectively invented.
Artifact counts describe authoring work, never difficulty/capability proxies.

## Gate/next

Corpus latest independentPASS22/all8axes, sourcebaef89ee; fullprcheck27PASS
(test204.4s/parity116.4s). Rechart/doc gates backlog/refs pass; additional branch
prcheck27PASS(test198.6s/parity116.5s) before new report RED files.
Report independent Contract+RED required before implementation. Live72 experiment,
no-model regeneration, final review still targets, not fabricated proof.
Expansion/owncampaign and I10/I11 remain linked goal work.
