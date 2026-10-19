# Ledger — no-coi-child-processes

- 2026-10-16 — seeded draft by the `esbuild-upstream-twin` refine (user: «Временно старый рантайм (Recommended)», option: «… kill = child-процессы в no-COI (отдельная цель) …»); evidence `docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md` §No-COI arm

- 2026-10-20 — native spike: Chromium 148.0.7778.96, Node v24.16.0; no COI/SAB; child sync XHR → SW → Window → owner reads/writes live state, 102 calls 40.5 ms. Direct SW→Worker message did not settle in 15 s; Window relay does.
- 2026-10-20 — user accepted SW prerequisite for children, preserved remaining SW-free SDK; draft amended before FIT. One PR.
- 2026-10-20 — acceptance upstream esbuild RED: shebang SyntaxError plus missing child.unref; native Node output `let x = 1;`.
- 2026-10-20 — FIT written-result PASS; Contract+RED accepted @ 537dfbafd, independent reviewer /tmp/no-coi-contract-red.json (posted on PR #380). Five expected RED; Node oracles pass. Concerns NOTE: strengthen stderr, native cleanup and natural esbuild termination before CLOSE.
