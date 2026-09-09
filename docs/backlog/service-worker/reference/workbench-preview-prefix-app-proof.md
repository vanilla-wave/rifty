# I5 generated App SW / production acceptance

Source implementation be8254b28683778925bdfd26a13b52df7446e4c0 already passed
full gate25/25 and mandatory packed host; independent Final provisionally
covered38rows. Additional generated App SW and production evidence follow here.

## Generated artifact

An I7 scratch runner accidentally inherited the App Vite plugin and regenerated
public/sw.js. The corrected scratch runner uses configFile:false and isolated
root/publicDir/cache; repeated native observations and unchanged git/hash were
verified. Parent owns the initial side effect, not a silent restore.

Actual production App build regenerated canonical public/sw.js from current
SW source:64additions/15deletions, configured prefix and routing version7. These
are this slice's symbols; the unrelated-generation revert exception in
process/traps does not apply. Include the canonical artifact and App changelog.

## Output oracle correction

Original full production suite:6/7GREEN; Fullstack test froze starting-count
at first HTTPfalse and saw7→8. Isolated replay repeated that criterion RED and
also logged one separate Playwright process.reserve pageerror. Original logs:
`/tmp/rifty-316-i5-app-prod.log`, `…-app-prod-isolated.log`.

Node24.16.0/nodemon3.1.14:8unforced signal/queued-write cases had stable count,
but actual output could arrive after first HTTPfalse. An explicit external
stdout-reader pause/resume fault reproduced exact count1→2 after HTTPfalse;
after native ChildProcess.close the transcript stayed stable. Neither result
claims a naturally reproduced exact-count RED or explains the browser pageerror.

Fresh critic independently repeated the native fault. Source plus passive DOM
trace found a second boundary: exact Run idle follows run.exited+run.close, while
DOM terminal-buffer refreshed16.215ms later. Accepted correction: await exact
Run idle, issue a real echo in that terminal, await its standalone output line,
then keep every old count/API/route/process/launch-fault assertion. A typed echo
substring is not an output marker. Corrected scratch journey passed34.7s.

Independent ruling: workbench-preview-prefix-nodemon-oracle.md. Original
criterion from git was reviewed; no runtime change, output suppression or
weaker teardown criterion. Actual production replay is recorded below after
completion, separately from the scratch critic run.

## Separate cancellation observation

The original Playwright pageerror is not dismissed by a green test. Bounded
native Worker/Workbench probes contain the same terminal reservation refusal:
starting precedes fork, ancestor terminationRequested rejects admission before
allocation, descendant settlement/output remain ordered. Actual queued
ErrorEvent after terminate also reaches the retained creator handler and is
preventDefault'ed. These controls have no pageerror and do not reproduce its
unknown actual propagation path.

No root cause for the captured pageerror was established, so no speculative
runtime fix. Question/trigger retained in kernel/recursive-worker-cancellation-
pageerror; independent Final reviews its attribution and disposition. Original
failure evidence remains history; the corrected oracle is not a cancellation
repair claim. Full diagnosis and independently executed commands are retained
as workbench-preview-prefix-nodemon-diagnosis.md.

## Actual production GREEN

`RIFTY_PLAYGROUND_PORT=5489 pnpm test:e2e:prod`:7/7GREEN,3.3min,
`/tmp/rifty-316-i5-app-prod-final.log`. Actual generated App build, realm Buffer,
owner boot, corrected nodemon whole journey38.5s, Hono/Koa, TypeScript F12+
dependency Problems and webpack cold install/HMR/reload all passed. No pageerror
in this run. Expected unavailable-route503 console messages remain visible.
The separate historical cancellation question is not represented as repaired.

## Source-size criterion correction

The next full gate passed24/25 (unit213.4s); only source-size failed because
the generated App bundle grew879→928 lines. Fresh independent PR-4 review
accepted excluding exactly apps/playground/public/sw.js and removing its879pin:
ADR-0016 owns the TypeScript source, while this artifact is generated. Existing
source measurement already excludes dist/build/generated directories.

Independent esbuild0.21.5/Vite5.4.21 regeneration with canonical App cwd and
plugin options matched all34579bytes, SHA256
de38baa05d3835d5ca3573990acebad5a558d49dd3ad20ac78da62d82991f5cf.
All33canonical inputs matched be8254b28. Candidate retained1096other measured
files,41pins,800threshold and150shrink-record delta. Real scratch unrelated
public/source801 and pinned growth stayed RED. No broader public exemption,
cap increase, minification or bundle split.

Exact candidate integrated, plus negative sibling-path coverage:10/10unit
checks and actual check:file-size GREEN. Process trap and root CHANGELOG record
the replaced classification/pin. Independent ruling:
workbench-preview-prefix-generated-criterion.md. Future artifact provenance
is not certified by this size exception; canonical builds and source review
remain required. Existing generated-sw-js-still-tracked-in-vcs draft is separate.
