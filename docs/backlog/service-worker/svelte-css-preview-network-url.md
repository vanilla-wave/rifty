---
area: service-worker
status: draft
title: Svelte CSS preview import reaches an external http://src URL
created: 2026-10-06
why: A real Svelte app with component CSS leaves the COI preview blank while the same reference works in packed no-COI and native hosts.
user_story: As a Playground user, I want a Svelte app with component CSS, but its preview requests http://src/App.svelte and Chromium blocks CORS.
sources: [docs/backlog/service-worker/reference/svelte-css-preview-network-url-observed.json.gz, docs/backlog/distribution/reference/agent-eval-corpus-expansion-evidence.md]
code: [packages/service-worker/src/route-preview.ts, tools/agent-bench/src/lanes/rifty.ts]
---

## Context

Real authoring control: installed Svelte5.38.7/plugin6.1.0/Vite7.3.6;
Node24.16.0/Chromium148.0.7778.96. Physical source/locks, browser console excerpts and trace hash
retained in reference/svelte-css-preview-network-url-observed.json.gz.
COI reference snapshot applied; preview blank, first Person action missing.
Browser requests http://src/App.svelte?svelte&type=style&lang.css from
http://localhost:5397 and reports CORS/ERR_FAILED. Exact same reference
PASS in no-COI/localPi-host/nativeCodex-host controls; no model invoked.

Compat ❌: this measured Svelte component-CSS path in COI. Not a universal
Svelte failure, Node limit or proved faulty layer. Code refs identify the
observed host/request boundary, not established root cause. Original series
is non-model authoring evidence; evolving judge criteria do not close quality
acceptance. URL request/source bytes remain the factual finding.

Dedup: bounded titles/code/maps/traps/ADR declined-concepts search found no
Svelte style/external URL equivalent; existing preview-prefix work
covers root-absolute requests, not this observed external request. Owned URL
projection/network boundary permits corrupt-input/sibling-drift; no proposed
coordination mechanism, no assumed Node oracle or ready tier/implementation.

Owner: agent at pickup. Trigger: repair before claiming this Svelte COI path
supported. PR341 measures/retains failure; its I10 diagnostics must verify exact
compiled specifier/request and effect through both public hosts. Root cause,
minimal organic repro and native response/provenance remain open; no prescribed
fix or source rewrite. Capture outside evaluation implementation scope.
