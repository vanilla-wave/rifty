# csv-workflow-v5, rifty no-COI — diagnostic re-run (not mixed into the series)

Question: is the rifty-lane csv drop in the
[upgrade series](../2026-11-23-pi-1.6.0-upgrade/README.md) (COI 3→1, no-COI 3→2) real?
The inputs match ([request comparison](../2026-11-23-pi-csv-native-diagnostic/rifty-requests.md)),
but the series ran next to local tests. This rerun uses lane `rifty-no-coi` only,
the same endpoint/limits/config, and an otherwise idle machine. 15 fresh trials per
version, run one after the other: 0.85.1 at clean `11b9397ee` (`pi-0.85.1/report.json.gz`),
1.6.0 at clean PR HEAD `7f4f6d977` (`report.json.gz`).

| Pi | PASS |
|---|---|
| 0.85.1 | 13/15 |
| 1.6.0 | 14/15 |

The drop is gone: it was noise.

Failed trials. Each failure is in the app the agent built; no judge step timed out
from load:
- 0.85.1 run 7, probe `workflow completed`: a 30 s locator timeout waiting for a
  Filter/Search textbox the app does not have.
- 0.85.1 run 14, probe `unsaved import leaves saved records intact`: assertion; an unsaved
  import replaced the saved rows.
- 1.6.0 run 10, probe `quoted fields/blank lines and invalid rows retained/editable`:
  assertion, emails dropped. Then `workflow completed` timed out at 30 s: the Save button
  stayed disabled ("Fix 1 issue").
