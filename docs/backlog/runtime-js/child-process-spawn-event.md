---
area: runtime-js
status: draft
title: ChildProcess never emits 'spawn'
created: 2026-10-25
why: Node emits 'spawn' once a child starts; rifty never does, so code awaiting it hangs silently instead of running or failing loud
user_story: As a dev whose script waits for `child.once('spawn')` before talking to the child, I want it to proceed as in Node, but today it waits forever
sources: [docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-worker.ts]
---

## Context

Node v24.16.0:

```sh
node -e "const c=require('node:child_process').spawn(process.execPath,['-e','0']); c.on('spawn',()=>console.log('spawn event')); c.on('exit',(code)=>console.log('exit',code))"
# spawn event
# exit 0
```

rifty (origin/main 7d038adb0, browser-unit owner, Chromium 148.0.7778.96,
2026-10-25): `spawn(process.execPath, ['leaf.mjs'])` followed by
`leaf.once('spawn', …)` never fires; the run hit its 30 s deadline with only
the parent's earlier output. `git grep "emit('spawn'" packages/runtime-js/src`
finds no emitter. No compat row names the event; it is neither implemented
nor a loud gap.

Owner: runtime-js child_process. Trigger: a guest or package awaiting
`'spawn'`. Dedup: `spawn-node-eval-arg`, `child-process-spawn-npm-and-bin-via-shell`
and the compat rows cover other spawn gaps, not this event.
