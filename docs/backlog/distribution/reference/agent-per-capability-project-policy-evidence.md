# Per-capability policy — I4

Baseline341986088, real Chromium + no-COI Worker; Memory VFS is the real
explicit ephemeral backend. Independent DEC-2 reviewer `policy_decision`:
use additive policies over the existing SDK handles; supersede only
ADR-0426 D1's one-handle requirement (ADR-0484).

RED2026-09-30:
`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi tests/no-coi/agent-capability-policy.spec.ts`
3 expected failures,1 baseline control passed,6.9s, exit1. Agent shell writes
where configured readonly was intended; inverse file restriction ignored;
capability root ignored rather than rejected. No missing imports/type failures.
Raw log `/tmp/rifty-pr357-policy-red.log`.

The npm control initially used arbitrary code as a .bin launcher, outside the
existing declared launcher grammar. Corrected fixture to the existing generated
relative-import shim plus actual CommonJS program; unrestricted/full allowlist
now succeeds while npm/node-only denies the nested bin. Product unchanged.

SDK owns all policy checking (`host-project-inputs.ts`, `no-coi-project-fs.ts`,
`no-coi-project-command.ts`). Project handles have no independent lifetime;
no new coordinator or enforcement. Native command outcomes are returned intact.

GREEN: new policy plus baseline policy/output/Stop Chromium suite8/8; strengthened
notes suite4/4; agent typecheck passes. Wrong-shell-notes mutant replaced shell
policy description with file policy: exact effective-policy assertion failed,
exit1 (`/tmp/rifty-pr357-policy-notes-mutant.log`); source restored. This closes
the Contract+RED advisory without changing the accepted policy semantics.

Final-review repair: own non-enumerable policy fields were enforced by SDK but
omitted from JSON notes (provenance-lie at policy projection). Real Chromium RED
`-g non-enumerable`: file/shell effects correctly blocked, notes missing both
readonlyPaths and inherited allowedCommands; exit1. Serialize the three known
SDK fields explicitly for common/files/shell. Same suite5/5 GREEN; the added
case also proves readonly path arrays replace common restrictions.
Raw logs `/tmp/rifty-pr357-policy-descriptor-{red,green}.log`.

Pre-repair full gate27/27: two vitest timeouts in
`packages/net/src/http/server.test.ts` and
`tools/node-parity-runner/src/run-in-rifty.test.ts` passed one isolated rerun
(load23.4/29.7/23.6 on12 CPUs). Failure did not reproduce in isolation;
contention suspected, no speculative source repair. Fresh full gate follows
this metadata repair.

Final full gate27/27, unit214.7s/parity120.1s; no isolated reruns. Independent final PASS8d55757fc closes both review findings.
