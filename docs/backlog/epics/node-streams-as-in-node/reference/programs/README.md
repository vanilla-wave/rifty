# Programs — moved

The scenario programs (`c-*`, `m1`–`m10`, `w1`, `b1`) live with the carrier's tests:
`packages/isolate-host/tests/fixtures/streams-scenario/`, their one source (unit 0, PR #467). `run.mjs`
reads them from there; `PROGRAMS=<dir>` still picks another directory. `m5-writestream.cjs` there takes
`--skip=<encodeURIComponent(row name)>` (the carrier's declared row skips); without it the rows are the
probe's.
