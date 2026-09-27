# PR362 resident rival fixture ordering

Observed required CI: run36357501105 / job108728099958, head ef446585d179b84f20df53b6b496abf5993439a6; 109PASS/1FAIL. Failure: no-coi-dev-hmr.spec.ts:454 delayed rival expected SandboxResidentPortOwnershipError / selected installed bin, received Error / resident port5196 is already in use. Same shape as recorded Firefox manual lane failure.

Root: eval arms a foreign HTTP listener after20ms, page awaits eval acknowledgement then sends startBin. No ordering guarantee keeps the timer after entry admission. startResidentNodeEntry correctly reports EADDRINUSE when the rival is already registered; post-admission registrations go through ownership checks. Existing adjacent native-deferred/late-createRequire fixtures already gate on a real selected-entry VFS marker; their earlier sweep missed this plain timer sibling.

Proof on real Chromium148, copied spec under /tmp (tracked files untouched during independent review): adding80ms between eval acknowledgement and startBin passed;1000ms reproduced the exact CI name/message mismatch. Proposed marker gate with identical1000ms stress passed. Same expected ownership assertion/events/Worker count retained. Commands:

RIFTY_NO_COI_PORT=5441 RIFTY_NO_COI_ORACLE_PORT=5442 RIFTY_NO_COI_RESOURCE_PORT=5443 pnpm exec playwright test --config /tmp/pr362-rival-proof/playwright.config.ts --project chromium -g 'resident readiness ignores selected auxiliary'

RED log /tmp/pr362-rival-red1000.log:1FAIL; GREEN /tmp/pr362-rival-green1000.log:1PASS6.4s. Config reused repo noCOI servers/projects with temporary testDir/output; temporary spec copied actual fixture/imports and changed only timing plus proposed marker gate.

Fault: observable-order, host→Worker fixture admission. Production occupied-port precheck remains unchanged and its earlier test remains required. No runtime hook, timer speedup, ownership override, mocked sibling or new coordination layer. 

Initial real-source verification (without injected1000ms delay):

```sh
RIFTY_NO_COI_PORT=5441 RIFTY_NO_COI_ORACLE_PORT=5442 RIFTY_NO_COI_RESOURCE_PORT=5443 pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-dev-hmr.spec.ts --project=chromium --project=firefox -g 'resident readiness ignores selected auxiliary|resident readiness rejects native deferred|late createRequire cannot|resident start rejects pre-bound'
```

**8PASS39.5s**, Chromium148.0.7778.96 and Firefox150.0.2. Includes genuine
pre-bound EADDRINUSE, wrong-port rejection, delayed rival, native deferred and
prior-loader ownership. Log `/tmp/pr362-rival-source-green.log`. Biome and
`git diff --check` pass. Completed draft deleted; historical named-run reds
remain in cross-engine evidence. Parent owns fresh final review, commit and
required CI gate rerun.

## Reception: remove the second timing assumption

Parent identified the remaining selected100ms deadline: after a Worker pause,
the rival's next20ms timer can lose to the overdue selected listener. A temporary
300ms synchronous selected-entry pause reproduced this second ordering flaw:
expected ownership rejection, got successful start (`failure: undefined`, no exit).
Log `/tmp/pr362-rival-workerpause-red.log`.

Final fixture orders both edges with real VFS markers: selected entry marks
admission; rival waits, listens, then its real listen callback writes rival-bound;
selected listener waits for rival-bound. Expected ownership error and pre-bound
EADDRINUSE oracle stay unchanged. The selected100ms deadline is gone; production
unchanged. Same temporary300ms Worker pause plus1000ms host delay: **1PASS**,
`/tmp/pr362-rival-workerpause-green.log`. Stress injection stays outside the repo.

Final source command: same real-source invocation above, grep limited to
`resident readiness ignores selected auxiliary|resident start rejects pre-bound`.
**4PASS** (Chromium + Firefox), log `/tmp/pr362-rival-final-source.log`; this verifies
the final two-marker fixture and preserves the genuinely pre-bound error. Biome
and scoped `git diff --check` pass.
