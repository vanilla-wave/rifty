---
area: distribution
status: draft
title: The isolate-guest-web-api user scenario runs as one sandbox case against live `node main.mjs`, committed RED
created: 2026-11-24
why: the goal's acceptance carrier — its walls are the later units; today the scenario stops at the ESM entry (`NotImplementedError('isolate-host.esm')`)
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/goal.md, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-host/tests]
---

## Context

Goal `isolate-guest-web-api` §User scenario as one `packages/isolate-host/tests` case: the
probe's way of laying `node_modules` (exceljs 4.4.0, pptxgenjs 4.0.1, nanoid 5) into a sandbox
snapshot (`isolate-library-probe/probe.mjs`), `sandbox.exec('main.mjs')` against `node main.mjs`
in a temp dir over the same files — stdout, stderr, exit code, output files (OOXML timestamps
masked as the library probe does). Committed `it.fails` (RED) before any wall is fixed.

## Question

Contract waits for the goal's open questions 1 (API set — which steps the file contains) and 2
(whose scenario counts); owner: user, asked 2026-11-24 (map.md).
