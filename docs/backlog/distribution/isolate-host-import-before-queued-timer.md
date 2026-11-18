---
area: distribution
status: draft
title: Isolate host — import() rejection handled by an already-queued timer exits 0
created: 2026-11-18
why: A guest timer that expired while the importing task ran is queued ahead of isolated-vm serving the import; its handler suppresses the unhandled report (Node exits 1).
epic: isolate-host-run-code
sources: [docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-host/src/child/main.ts]
---

## Context

`runCode("let p; setTimeout(() => p.catch(() => console.log('late'))); const t = Date.now(); while (Date.now() - t < 30); p = import('x')")`
→ `late`, exit 0 (5/5); Node v24.16.0 exits 1. The host fires the expired
timer into the isolate before isolated-vm serves `importModuleDynamically`;
the empty-task flush (ADR-0557 §5) covers only tasks queued after the
request. Settles it: a guest-owned `import()` (eval-source rewrite to a guest
function that rejects in the guest realm) or isolated-vm serving import
requests synchronously.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
