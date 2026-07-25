---
area: process-meta
status: draft
title: Enforce the draft→ready gate mechanically
created: 2026-07-05
why: «never implement from a draft» is prose only (decision-workflow §Backlog readiness) — PR #107 was implemented from a draft epic and the violation was recorded post-hoc (its r11); a rule without a gate doesn't hold under delivery pressure
user_story: As the repo owner, I want implementation started from a `draft` item to fail loudly at a gate, but today nothing checks item status at implementation or PR time
---

## Context

Candidate mechanics (pick at refine):

- implementer entry points (skills / agent preamble) refuse a `status: draft` target — cheapest, catches the front door;
- `pr:check` cross-ref: a PR that claims delivery of an item (branch↔item or PR-body marker convention — to design) requires that item `ready`;
- same gate family: a `draft→ready` flip in the diff requires its `ready-verdict:` line, judge-authored — a parent-transcribed verdict is a laundering channel (2026-07-25 audit exploit #1); candidate: verdict artifact hashes the item content;
- NOT a gate on epics having draft children — that's the designed shape (decision-workflow); the violation is implementing a draft child, not having one.

Must not block legit exploratory spikes (not deliveries).
