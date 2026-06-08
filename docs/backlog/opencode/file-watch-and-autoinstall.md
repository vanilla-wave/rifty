---
area: opencode
status: parked
title: Real file-watch / plugin auto-install for the opencode facade (currently degraded-no-op)
created: 2026-06-08
why: FileWatcher.init and @npmcli/arborist install both hit the native ceiling and are no-op/swallowed; open a fresh ADR only if either becomes load-bearing
sources: [docs/compat/opencode-tool-ceiling.md §Observed at boot — degraded-but-non-fatal, docs/opencode/README.md DB-READ row, audit-digest]
---
## Context
Driving the real server (BOOT + DB-READ gates) surfaced two server-internal capabilities that hit the no-native-addon ceiling but which opencode itself DEGRADES GRACEFULLY (logs + continues, request still 200): (1) file watching — `FileWatcher.init` needs the native `@parcel/watcher-<platform>-<arch>` addon → no-op watch (`watcher backend not supported`, file/watcher.ts:84-85); (2) plugin/dependency auto-install — dynamic `import('@npmcli/arborist')` (npm-install machinery, intentionally outside KEEP deps) → background install fails, swallowed (`Cannot find module '@npmcli/arborist'`). Both consistent with the no-tool-execution facade; same "no native addon / no spawn" line already drawn.
## Options / Next
Neither needs a stub or ADR today — opencode's own error-handling keeps them non-fatal. If a future need makes either LOAD-BEARING (e.g. real file-watch via a polling/chokidar fallback, or actual plugin auto-install), open a fresh ADR THEN. Next: no action; disclosed in the tool-ceiling doc so the degradation is recorded rather than silent.
## Reversibility
N/A now (degradations sit on the already-drawn no-native-addon line; no decision pending). A future polling/chokidar fallback or real auto-install would be its own ADR. Parked.
