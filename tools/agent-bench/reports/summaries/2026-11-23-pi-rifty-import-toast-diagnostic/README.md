# rifty COI lane: workspace-import toast — diagnostic re-run (not mixed into the series)

Question: did the PR cause the 2 setup failures in the
[upgrade series](../2026-11-23-pi-1.6.0-upgrade/README.md)? In both, the
workspace-import success toast was not visible within 90 s, before the agent started
(`stringify-boxed/rifty/3`, `queue-clear/rifty/2`; the baseline had 0 such failures).

The rerun used lane `rifty`, task `ms-negative` (fast), the same endpoint/limits/config/port,
and clean PR HEAD `3eb88aaac`. 15 fresh trials ran on an idle machine.

Result: 15/15 imports observed, 0 setup failures, and 15/15 PASS; agent runs took 17–40 s.
Over the series plus this rerun, 2 timeouts in 33 rifty imports on pi 1.6.0. The import
runs before any agent or pi code, and the PR does not touch the import path, so the
failures fit the pre-existing flake (backlog
`playground/workspace-import-success-observation-timeout`, also seen in eval-v18).
This rerun does not establish the rate precisely.
