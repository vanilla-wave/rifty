---
kind: epic
status: draft
title: Multi-tab story — same project in two tabs is defined, safe, honest
created: 2026-07-02
value: A user who opens the playground (or the same project) in a second tab gets defined, documented behavior — never silent data corruption, never a hung preview with no explanation.
user_story: As a user who duplicates the tab (or opens a shared preview URL while the playground is open), I want each tab to either work or refuse loudly, but today two tabs mean two owner workers over the same OPFS project, concurrent writes with undefined outcome, and a preview that 503s without telling me why.
items: []
---

## Outcome

The multi-tab scenario is currently undesigned: only explicit-port claim is single-owner (ADR-0186 BroadcastChannel claim), SW preview refuses to guess between two windows on one port (503), everything else — two owner workers on one OPFS project, concurrent VFS writes, duplicated dev servers, session restore racing — is undefined behavior. Silent-corruption risk contradicts the fidelity mission; "refuse loudly" is fine, "undefined" is not. Draft: needs discovery (what actually happens today — OPFS sync-access exclusive locks may already fail one side) before decomposition into items (e.g. Web Locks project single-owner, read-only second tab, honest takeover UX, cross-tab preview routing story).

## User scenario

(to be refined) A user with a running project duplicates the tab. The second tab either: attaches read-only with a visible badge, offers an explicit takeover, or refuses with a clear message — chosen by design, parity-checked where observable. No path leads to silently interleaved OPFS writes or a preview that stops responding without diagnosis.

## Items

None yet — discovery first: document today's actual two-tab behavior (OPFS locks, owner duplication, port claim, SW routing), then decompose.
