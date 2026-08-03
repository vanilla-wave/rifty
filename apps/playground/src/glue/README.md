# glue — app-local browser integration

Framework-free Playground policy and browser adapters: editor/file-tree state,
SCM presentation, terminal UX, persistence, project seed/configuration, Monaco,
HMR, and browser capability helpers.

Belongs here: app-specific state or adaptation shared by UI surfaces. Doesn't:
page↔owner ports, Workbench protocol, project/package authority, or worker
lifecycle (→ `@riftydev/workbench`); Solid rendering (→ `../components` and
`../adapters`); generic Node/platform behavior (→ `packages/*`).

Known debt: sibling request/reply correlation engines await one substrate
(`backlog: playground/correlated-broadcast-bridge-helper`); minting another
copy violates the mechanism sweep (`docs/process/fault-classes.md`
§Class-kill).
