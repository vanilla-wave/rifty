# CI resident fixture ordering repair

PR333 CI34731523784/job103655112577:93PASS/2FAIL. Existing native-deferred and
late-createRequire ownership fixtures got generic EADDRINUSE5200/5220 instead
of selected-bin ownership errors. Isolated unchanged run2PASS7.6s.

Birth: rival armed20ms before page awaits eval/runBin reply and sends startBin.
`startResidentNodeEntry` correctly rejects an already occupied port at admission;
only registrations after admission enter its ownership check. Test assumed an
RPC timing bound. Injecting80ms between eval ack/startBin reproduces exact5200
CI failure (1FAIL/1PASS); late-createRequire sibling did not reproduce in isolation.

Fault: ordering at fixture host→Worker admission, not a changed runtime outcome.
Sweep: both prior-loader schedulers in no-coi-dev-hmr.spec.ts; no other20ms rival
schedulers. Each now waits on a real VFS marker written by selected entry before
arming its native callback. Prior loader/createRequire identity remains captured
before entry; expected errors/events unchanged. Existing VFS and timers suffice;
no runtime hook, owner-token override or production coordination added.

Other axes at this boundary: persistence/crash/retry/secret disclosure absent;
fixture uses one temporary sandbox, no writes cross contexts. Registration/liveness
and earlier occupied-port siblings retain their existing assertions.

Commands: `pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --grep 'resident readiness rejects native deferred|late createRequire cannot'`.
Logs: /tmp/pr333-ci-no-coi-isolated.log (2PASS),
/tmp/pr333-ci-no-coi-ordering-red.log (injected80ms exactRED),
/tmp/pr333-ci-no-coi-fixture-green.log (2PASS7.9s),
/tmp/pr333-ci-no-coi-ordering-green.log (same80ms2PASS8.0s).
The injected page delay was removed after verification. Full no-COI suite and
independent final review remain required with benchmark delivery.
