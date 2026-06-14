---
area: playground
status: active
title: Terminal npm install writes the page-realm VFS, never the Real Vite worker's VFS — installs invisible to the preview
created: 2026-06-13
why: The terminal `npm install` writes a page-realm SyncMirrorVfs, but Real Vite runs in a worker realm with its own syncMirror, so packages installed from the shell never reach the realm the preview reads — and the only tracked remediation (bidirectional Editor↔Worker sync) is M12-gated; the narrower shell-write gap has no standalone item.
user_story: As a developer using the rifty web playground, I want `npm install express` in the visible terminal to be importable by the running preview, but today the install lands in the page-realm VFS while Real Vite reads its own worker mirror, so the new module never resolves and HMR can't pick it up until restart.
sources: [ADR-0043]
code: [apps/playground/src/App.ts, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/glue/vfs-write-port.ts, apps/playground/src/glue/sync-mirror-vfs.ts, apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

Real Vite builds its own `new SyncMirrorVfs()` + install({vfs,cwd,registry}) into the worker's mirror (real-vite-bootstrap.ts:345-356). The page->worker VFS write port carries only 'write'/'mkdir' editor frames — no install path. The terminal's npm command writes the PAGE realm (App.tsx:171 const npmVfs=new SyncMirrorVfs(), wired into createNpmShellCommand). So `npm install express` lands in the page tree, the running worker never sees it, and the preview/HMR can't resolve the new module. ADR-0043 flags this as a real asymmetry but its only listed remediation (Editor↔Worker bidirectional sync) is blocked on ADR-0013 phase-2/M12 and is broader (about source edits, not installs). As the standable M11 path leans on the visible terminal, terminal-driven installs silently diverge from the preview's source of truth.

## Options or Next

1) Route terminal npm install through the worker: extend the VFS write port (or add an install RPC) so the shell triggers/install-mirrors into the worker realm's syncMirror, then publishSnapshot + node_modules-read bridge surface it to the page explorer. 2) Or honestly gate: when Real Vite is running, forward terminal npm install to the worker (single source of truth = worker for node_modules) instead of writing the page VFS. 3) Cheap interim: detect a running worker and surface a terminal warning that shell installs won't reach the preview until restart. Distinct from the M12-blocked bidirectional source-sync.

## Reversibility

REVERSIBLE — backlog item; playground adapter wiring + a one-way port extension / shell command behavior, no public package API change while installs stay worker-applied. A new cross-realm install/sync wire format would need an ADR.
