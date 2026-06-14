---
area: shell
status: parked
title: Minor GNU usage-error fidelity in find/ls (polish)
created: 2026-06-08
why: 3 usage-error fidelity nits in find/ls — all loud/safe, not silent stubs, just mis-shaped vs GNU
user_story: As a developer at the rifty shell prompt, I want `find -name` with no value or `ls --color=BOGUS` to report a GNU-style usage error (exit 2), but today they silently match nothing or throw `NotImplementedError` instead.
sources: [Q-2026-06-07-412]
---

## Context

(1) `find -name` with a MISSING value silently sets `name=''` (empty regex → no output, exit 0) instead of GNU `find: missing argument to -name`; (2) `find -type` missing value throws `NotImplementedError('shell.find.-type')` — loud but mislabels a usage error; (3) `ls --color=WHEN` with invalid WHEN writes a GNU-style stderr line then throws `NotImplementedError` — should be a GNU usage error (exit 2).

## Options or Next

Low-priority polish: convert these three to GNU usage errors (stderr + exit 2/1, no throw) when next touching find/ls. Not blocking — current behavior is loud and safe.

## Reversibility

REVERSIBLE — local error-path tweaks, <1 file each (CHANGELOG-only).
