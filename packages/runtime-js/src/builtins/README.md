# builtins — Node builtin modules

One `node:<name>` builtin surface per file (`fs` split by concern: errors,
path, stats, streams, watch, sync-mirror). Behavior is parity-proven against
real Node; a missing feature throws `NotImplementedError('<module>.<feature>')`
+ compat-matrix row — never a stub.

Belongs here: the observable surface of one Node builtin. Doesn't: module
loading/resolution (→ `../module-loader`), env/capability detection
(→ `../env`), cross-realm IPC (→ `../ipc`, `@riftydev/kernel`).
