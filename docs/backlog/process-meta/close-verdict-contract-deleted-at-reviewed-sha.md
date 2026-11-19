---
area: process-meta
status: draft
title: A CLOSE landing verdict cannot name its deleted contract — blockers.mjs reads it at reviewed_sha
created: 2026-11-19
why: The CLOSE removes the goal documents in the same tree the landing verdict binds to, so the validator cannot read the contract and skips its coverage-count check.
sources: [tools/review/blockers.mjs, tools/checks/pass-binding.mjs, docs/process/README.md]
code: [tools/review/blockers.mjs, tools/review/contract.mjs]
---

## Context

Finding (CLOSE of goal `isolate-host-worker-pool`, PR #412, 2026-11-19). The landing verdict's `reviewed_sha` was the CLOSE tree (7c53ded38), where the goal directory `isolate-host-worker-pool` and its carrier contract were already deleted. `node tools/review/blockers.mjs <verdict>` with `unit_goal_source` naming the contract path exited 2 ("unreadable contract"). The reviewer had to name the documents through `git show b6d8a8625:…` instead of a literal `docs/backlog/…` path, which also turns off the check that the coverage rows match the contract. The isolate-guest-embed CLOSE avoided it only because its verdict was bound before the deletion. Open: read the contract at the parent of the deleting commit, or bind CLOSE verdicts to the last tree that still has the goal.

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
