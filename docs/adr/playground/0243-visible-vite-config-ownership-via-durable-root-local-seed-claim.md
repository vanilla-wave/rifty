# ADR 0243: Visible Vite config ownership via durable root-local seed claim

Status: Accepted
Date: 2026-07

> TL;DR: visible template `vite.config.*` is ordinary user content; one durable root-local seed claim distinguishes fresh absence, torn seeding, edits, and deletion.

## Context

The hidden CLI config wrapper owned policy the user could not see. Moving policy into template `vite.config.js` creates an ownership ambiguity on reload: absent can mean never seeded or deliberately deleted. Content heuristics cannot remember deletion; `ProjectIndex` is profile-global project identity and does not travel naturally with copied/imported roots. ADR-0187 also proves sync write/FIFO is not durability.

## Decision

- One Vite precedence slot (`js,mjs,ts,cjs,mts,cts`). Any occupied variant is user-owned; never shadow or overwrite it.
- Claim path: `<root>/.rifty/vite-config.seeded`, versioned JSON naming starter + claimed relative file. It travels with/reset alongside the root; it is not `ProjectIndex` state.
- Valid claim + missing config = user deletion. Valid claim + changed config = user edit. Preserve both.
- No claim + exact sole seed bytes = torn transaction; durably reassert bytes, then claim. Other/multiple config = user ownership; do not claim.
- One writer owns the slot: config write → checked durability drain → claim write → checked drain. Corrupt/unsupported claims loud-fail.

## Fault matrix

| Fault | Required outcome |
|---|---|
| Config write/persist fails | No claim; loud failure; retry safe. |
| Claim write/persist fails | Exact config without durable claim; retry completes claim. |
| Durable claim + missing config | Never resurrect deletion. |
| User edit / alternate extension | Preserve bytes/path; never claim over it. |
| Reload / Save | Claim travels with the root. |
| Reset / preset switch | Old root/claim removed; new baseline gets a new claim. |
| Corrupt claim | Loud failure; never silently suppress seeding. |

## Consequences

- Visible config becomes the sole user-editable policy surface; wrapper args/env retire.
- One small internal file buys unambiguous deletion and torn-write recovery.
- Seed owners validate and durably reassert an existing claim; creation/recovery uses two drains.
