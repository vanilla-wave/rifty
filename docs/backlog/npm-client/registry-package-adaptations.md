---
area: npm-client
status: ready
title: Consolidate existing package adaptations under registry ownership
created: 2026-09-07
why: Preserve supported programs while removing package policy from generic platform owners.
epic: vite-knowledge-boundary
sources: [ADR-0384]
---

## Context

Move finite existing implementations and their exact criteria; inventory and baseline in `docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`. Registry runtime is a closed composition entry; data catalog stays data-only.

## Challenge

challenge: 2026-09-07 — clear; reuse PR #314 goal premise, independently checked carrier and ADR corrections at FIT.

## Acceptance

1. Registry owns every finite inventory adaptation; platform contains no independent package patch/version/hash/startup/manifest policy. Mechanical ownership/dependency checks accompany real-package acceptance. → I1
2. Registry realm publication preserves exact CJS outer identity across bundle copies, startup before ordinary script/eval/bin import, existing info-mode suppression and installed-tree/offline authority; runtime-js has no package API/key. Existing adapter/entry contract suites and esbuild browser differential proof. → I2 + scenario
3. Ordinary `.vite/notes.txt` survives file snapshots and archive roundtrip/import; generic dependency/server diagnostics do not claim Vite provenance. Real Memory VFS RED plus browser file/archive proof. → I3 + scenario
4. Real supported Vite build/dev/HMR/restore paths remain in COI/no-COI, optional public helpers still work; Express has ordinary acquisition/execution/files/diagnostics. Existing browser/packed consumer suites plus ordinary entry proof. → scenario
5. Existing Rollup/LightningCSS/Sass/bcrypt substitutions and supported emnapi behavior retain their package bytes/observable results. Existing real-tarball/contract/browser suites. → I1 + scenario

## Reference contract

Existing supported behavior at `df3cd222f`; pinned esbuild 0.28.0 and Vite 7.3.6 differential artifacts retained. No new Node semantics claimed.

## Parity cases

1. Preserve the existing esbuild real-Node differential rows and declared loud gaps under registry ownership; existing browser `esbuild-vite-contract` and registry oracle suite. → scenario

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| corrupt-input × binding dispatch | unknown/duplicate/path/size/hash failures throw before publication | existing runtime-adapter contract suite | → I2 + scenario |
| poisoned-cache × installed tree reuse | same authority validates exact installed bytes and rejects stale prepared tree | package finalizer, entry prep and owner package contract suites; offline browser restore | → I1 + scenario |
| sibling-drift × COI/no-COI activation | common registry implementation preserves supported results | real COI/no-COI build/dev suites | → I1 + scenario |

## Out of scope

New package support, new delivery/cache/lock/extension mechanisms. Existing esbuild CLI, sync methods, write build, analyzeMetafile, watch/serve gaps retain their loud failures and compat status. Unrelated preset-deglue lifecycle work.

## Decisions

ready-verdict: 2026-09-07 — Contract+RED @ 90b1a75335476e27f98cad56574acdef95f94cff

- 2026-09-07 — ADR-0384 defines registry-owned carrier and corrections; accepted scope unchanged.
- 2026-09-07 — existing semantic proof retained; six executed REDs discriminate package ownership and captured ordinary-file defects before any product edit.
