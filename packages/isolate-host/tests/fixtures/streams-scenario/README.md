# node-streams scenario programs

The node-streams goal's scenario programs, run by the carrier (`../../streams-scenario.ts`, cases in
`../../streams-scenario.test.ts`, `tests/browser-unit/streams-scenario.spec.ts`,
`tests/no-coi/streams-scenario.spec.ts`) against live Node v24.16.0. This directory is their one
source: the goal's probe (`docs/backlog/epics/node-streams-as-in-node/reference/run.mjs`) reads them
here, and an edit here runs the carrier in CI.

- `c-*`: the goal's User scenario, with exceljs 4.4.0's closure as `node_modules`. Every host.
- `m1`–`m10`, `w1`, `b1`: the matrices (`<row> => <value>` lines), browser hosts.
- `m5-writestream.cjs` takes `--skip=<encodeURIComponent(row name)>`: that row prints `skipped` and runs
  nothing, on the Node side and the guest side alike (the carrier's declared row skips).

Each program writes its inputs and outputs in its own directory; the carrier compares every file
left there (`streams-scenario.ts` header). Programs print no `process` state.
