---
area: distribution
status: draft
title: "Make the agent-bench Playwright trace opt-in and capture page errors as text"
created: 2026-10-16
why: The per-attempt Playwright screenshot stream was 1.46 GiB of the 1.74 GiB eval-v18 evidence while nothing reads it; the two human uses were pageerror text
sources: [docs/adr/distribution/0532-commit-evaluation-summaries-as-text-core-only.md, docs/adr/distribution/0434-run-a-three-lane-pi-benchmark-with-shared-profile-and-native-judges.md]
code: [tools/agent-bench/src/runner.ts, tools/agent-bench/tests/contract.spec.ts]
---

## Question

ADR-0434 captures a real Playwright trace (`screenshots: true`) for every attempt;
`tests/contract.spec.ts` requires it (the two origin-control scripts that parsed its
`*.trace` events left with the record-observation engine, ADR-0535). Nothing else
reads `browser.zip`; the diagnoses that used it
(Svelte HMR blank preview) needed only `pageerror`/console text.

Proposed: trace off by default, `--browser-trace` flag for manual debugging;
runner records `page.on('pageerror')` and `console` messages into `trace.json`
per attempt. Contract spec moves to the textual capture or runs with the flag. Local run directories shrink from ~1.7 GiB to ~60 MiB per
96-attempt series; committed evidence is unaffected (ADR-0532).

Owner: agent — pickup writes the contract (which attempt facts the text capture
must carry) and RED before changing the runner; ADR-0434 §trace gets a DEC-2 note.
