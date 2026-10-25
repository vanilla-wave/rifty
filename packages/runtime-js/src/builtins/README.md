# builtins — Node builtin modules

One `node:<name>` builtin surface per file (`fs` split by concern: errors,
path, stats, streams, watch, sync-mirror). Behavior is parity-proven against
real Node; a missing feature throws `NotImplementedError('<module>.<feature>')`
+ compat-matrix row — never a stub. `loud-members.ts` holds ADR-0443's
named-loud members (linked/bound at load, every call throws) for their owners
(`fs`, `child_process`, `process`).

Belongs here: the observable surface of one Node builtin. Doesn't: module
loading/resolution (→ `../module-loader`), env/capability detection
(→ `../env`), cross-realm IPC (→ `../ipc`, `@riftydev/kernel`).
