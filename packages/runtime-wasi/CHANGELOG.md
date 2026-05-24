# Changelog

## [Unreleased]

### Added

- WASI preview1 shim (`Wasi` class). Implements: args_*, environ_*, fd_read, fd_write, fd_close, fd_seek, fd_fdstat_get, path_open, path_filestat_get, path_create_directory, proc_exit, clock_time_get, random_get. Missing calls return `ENOSYS` instead of silently no-oping.
- `runWasi(bytes, opts)` convenience helper that instantiates a module and runs `_start`.
- Preopens are routed to the runtime-js `syncMirror()` — `fs` sees what WASI writes.
