# workers — owner-realm authorities

Worker-side owners spawned via the kernel: project/catalog authority, owner VFS
authority + applied journal, package acquisition/state, PTY server, preview
registry, Vite/Node child bootstraps (`real-vite-bootstrap`,
`workbench-owner-*`, `dev-server-child-*`).

Belongs here: owner/worker-realm code holding authoritative state or spawning
child realms. Doesn't: page-realm bridging (→ `../glue`), Workbench page facade
+ protocol (→ `../workbench`), UI (→ `../adapters`, `../components`).
