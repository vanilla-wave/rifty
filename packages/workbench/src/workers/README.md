# workers — owner-realm authorities

Worker-side owners spawned via the kernel: project and catalog authority, owner
VFS authority, package acquisition, PTY, preview, and Vite/Node child
bootstraps.

Belongs here: owner/worker-realm code holding authoritative state or spawning
child realms. Doesn't: page-realm bridging (→ `../glue`), Workbench facade and
protocol (→ `../workbench`), or host UI.
