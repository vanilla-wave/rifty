# glue — page-realm integration

Page-side ports, clients, and bridges connecting the UI to the owner worker and
platform packages: `*-port.ts` (page↔owner request/reply), `*-client.ts` (frame
marshaling: VFS, PTY, TS LS), project index/boot/seed, npm/git/preview/HMR
wiring.

Belongs here: the page-realm side of ONE channel or concern, one file per
channel. Doesn't: owner-realm authority (→ `../workers`), UI state/rendering
(→ `../adapters`, `../components`), Workbench public surface + protocol
(→ `../workbench`), generic Node/platform behavior (→ `packages/*`).

Known debt: sibling request/reply correlation engines await one substrate
(`backlog: playground/correlated-broadcast-bridge-helper`); minting another
copy violates the mechanism sweep (`docs/process/fault-classes.md`
§Class-kill).
