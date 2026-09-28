## Items

## Open questions

None. Physical iOS execution excluded by the user amendment of 2026-09-28; iOS remains unmeasured. Final closure review pending.

## Out of scope

- Widening Safari persistent below 26 (replica on sync-access-handle writes) — question `vfs/safari-pre-26-replica-without-createwritable`; user 2026-09-27 "2a".
- COI on WebKit via `COEP: require-corp` (D-001 supersession) — question `distribution/coi-on-webkit-require-corp`; user 2026-09-27 "2a".
- Firefox <145 in COI (`Atomics.waitAsync` polyfill) — question `kernel/firefox-pre-145-coi-waitasync-polyfill`; user 2026-09-27 "2a".
- Any scheduled lane or release gate — user 2026-09-27 "пока без расписания".
- Fixing Firefox/WebKit product reds found by items 5/6 — user 2026-09-27 "Только записать"; each red becomes a draft finding outside the epic.
- Gates of external embedding hosts (their own capability checks) — outside this repo.
- Android device memory beyond what item 8's protocol observes — no device farm.
