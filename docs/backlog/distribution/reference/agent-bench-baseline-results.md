# Measured baseline

Fresh synthetic Trackline; real host tools/Node/npm; deterministic model only at
external HTTP boundary. Script: tools/agent-bench/tests/baseline-probes.ts.
Raw report+trace: adjacent agent-bench-baseline-*.json.gz; command/result rows:
agent-bench-baseline-observations.json. Quality-task denominator excludes these probes.

| Surface | Native Node | COI +chat | Packed no-COI |
|---|---|---|---|
| React declaration files | present | fixed; @types/react/react-dom19.3.0 present | fixed; same declarations present |
| .bin/tsc --noEmit | exit0 | exit0 after tar repair | exit0 after tar repair |
| Monaco diagnostics(src/App.tsx) | no Monaco host | [] after tar repair | capability intentionally omitted |
| node -e / -p | expected text /42 | same | same |
| pwd / echo / foreground pipe to cat | pass | pass | pass |
| git | initialized native repository | initialized project repository | real init/status work; SDK seed starts without .git |
| Vitest2.1.9 | installed; real test passes | installation explicitly rejects legacy esbuild ^0.21.3 | agent npm install is a directed host-policy ceiling; owner toolchain.install independently rejects the same legacy esbuild version |

The earlier TS2688/7016/7026 observation was a reproduced extraction defect,
not a missing declared dependency or unresolved TypeScript-host question.
ADR-0435/root repair and original npm-byte oracle accompany this PR.

The probe also found git status --short falling through to long output. Native
Git2.50.1 proves it aliases -s for the captured flat-file case. Existing formatter
now recognizes --short; 3-flag RED/GREEN and the full git CLI/fixture suite cover it.
Remaining directory-collapse behavior is the already-tracked
`docs/backlog/shell/git-status-porcelain-untracked-dir-collapse.md`; this measurement
claims basic git availability, not complete native porcelain equivalence.

Vitest result is version-specific, not a claim about every release. The2.1.9
version is this repo's own test runner. Its esbuild rejection and the no-COI
project-vs-toolchain install policy are existing explicit ceilings; no new
feature was invented or silently approximated to close this measurement.

Native and browser dependency resolutions may differ under the same semver input.
Model/profile equality does not prove dependency, tool or context equivalence;
quality findings must inspect retained locks, file trees and raw tool outcomes.
