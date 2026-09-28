---
area: npm-client
status: draft
title: The eddy fast-path decline reason reaches the npm install terminal output, including the automatic install of a from-scratch project open
created: 2026-09-27
why: success is announced in the terminal (`via eddy (fast)`) while the decline goes to `console.warn`, so a user whose fast path failed sees only a slower install and never the reason
user_story: As a developer running `npm install` — typed, or run for me when a template with preset pins opens from scratch — in a project served by the eddy resolver, I want the terminal to say why the fast path was skipped when it is, but today that line (`npm: fast install (eddy) unavailable, using standard install — <reason>`) is written to devtools console only
epic: honest-substitution-signals
sources: [ADR-0182, ADR-0194, ADR-0195, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [packages/npm-client/src/eddy-fast-path.ts, packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/workbench/internal/project-runtime-acquisition.ts]
---

## Context

Finding (observed on `99fdf6c91`): `declineEddy`
(`packages/npm-client/src/eddy-fast-path.ts:493`) writes
`console.warn('npm: fast install (eddy) unavailable, using standard install —
${reason}')` — text already formatted for the terminal (`npm:` prefix) but
with no sink parameter. The npm shell command
(`packages/workbench/src/glue/npm-shell-command.ts`) already routes the other
eddy facts to the terminal: cached resolution + background refresh (:859),
pin refresh failure (:867), `via eddy (fast)` on success (:893), and it passes
`onPackage` / `onSubstitution` sinks into the installer (:827, :834). The
installer also already returns the decline as data:
`InstallResult.provenance.eddyFallback.reason`
(`packages/npm-client/src/installer.ts:211`, set at :532; asserted in
`installer-shadow-shims.test.ts:549`) — and the shell command never prints it.
The learned-pin write failure (:890) is a second eddy outcome that goes to
`console.warn` only. In a Worker realm `console.warn` is devtools-only; the
page never sees it. No test names the decline text
(grep over `packages/**/*.test.ts` → none).

Eddy's main path — a from-scratch open of a template with preset pins — is
also a terminal install: the deferred `install` plan
(`package-acquisition-authority.ts:188-198`) becomes
`npm install && <runtime line>` in the project's terminal
(`packages/workbench/src/workbench/internal/project-runtime-acquisition.ts:9-22`),
so the same shell-command sinks apply. The only terminal-less acquisition,
`activate-and-ensure`, runs in companion-less Workbench
(`workbench-owner-runtime.ts:344-356`) and is out of scope here.

Expected: the decline reason appears once in the npm command's terminal
output (stderr, like :867) for a typed and for an automatic from-scratch-open
install alike; ordering relative to the standard install and the carrier
(print `eddyFallback.reason` from the result, or a sink into `declineEddy`)
are agent-owned; the pin-store and prefetch behavior described in
ADR-0194/0195 is unchanged. No new channel, no new event kind (fault-classes
§Class-kill); the :890 line rides the same sweep.

Dedup: no title/`code:`/map/declined match. Related eddy items
(`perf/eddy-http3-cold-validation`, `distribution/eddy-package-and-deploy`)
are deploy/perf, not terminal honesty; `distribution/eddy-live-esbuild-closure-decline`
quotes the same `eddy-fast-path.ts:493` line as evidence of client-side
honesty — refresh that quote when this lands.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
