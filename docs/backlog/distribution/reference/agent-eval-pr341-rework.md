# PR341 measurement correction — 2026-10-13

Original eval-v16 is complete, confounded history; clean comparison pending.
Original report, scores, traces, source bundle and prior verdicts unchanged.
[96-row diagnostic sidecar](agent-eval-pr341-rework-classification.json.gz)
binds each observation to original report/source/trace SHA256.

| Original observation | Count | Attribution/limit |
|---|---:|---|
| SHA-1 integrity rejection |18|Rifty npm-client setup, zero tools/tokens; COI says integrity mismatch, no-COI unsupported algorithm.|
| `string-width-cjs@npm:string-width@^4.2.0` resolution rejection |4|Rifty npm-client setup, zero tools/tokens.|
| queue-clear COI workspace-import timeout |2|Success toast absent after90s; zero tools/tokens, root cause unisolated.|
| Parallel Pi tool calls with empty arguments |571/571|159 COI,176 no-COI,236 native Pi;46 attempts exposed.|
| Single Pi tool calls with empty arguments |0/317|Same original traces; batching correlation, not model-quality score.|
| Reported malformed tool results |566|Result counter differs from transcript calls; never replace it with571.|
| Original outcomes |43PASS/53FAIL|24 setup failures;29 started-agent failures retain unknown outcome cause.|

Handoff's18 SHA-1 +6 alias allocation overstates directly observed aliases:
two queue-clear COI rows carry import-timeout errors. No retrospective rescue,
rescoring, pruning or runtime-only/model-quality conclusion. Native Codex uses
different model/context/tools and bypasses this proxy. Shared booking/expense
failures are not proof of a Rifty ceiling or a defective judge; investigate
only after a fresh clean comparison.

Sidecar `failureClass` is diagnostic, separate from report enum: `none` means
original PASS even with obstacles; `rifty-tooling` names proven install setup;
`ai-mode-ux` names observed import timeout, not its cause; `unisolated` means
started-agent FAIL with outcome cause unknown. Confounds may overlap. Frozen
report's original null assignments remain unchanged.

## External proxy proof

`/Users/vanilla-wave/codex-proxy.mjs` ignored final AI SDK `tool-call` input
when backend sent no `tool-input-delta`. External patch emits final input only
when no arguments were already emitted. Pi0.85.1 delta assembly unchanged.
[Durable request/SSE/patch evidence](agent-eval-pr341-proxy-proof.json.gz)
contains no auth headers. Patch is outside rifty; probe proves this protocol
case, not a clean coding-quality campaign.

Executed in this session (network-enabled shell):

```sh
curl -sS --max-time 90 -H 'Content-Type: application/json' \
  --data-binary @/tmp/pr341/probe.json \
  http://127.0.0.1:10530/v1/chat/completions \
  -o /tmp/pr341/pr341-rework-probe.sse
```

SSE deltas assembled by tool index;4 `read_file` calls,4 valid JSON arguments:
README.md,package.json,src/App.vue,src/main.js. Assertions PASS. Initial
sandbox-only request could not connect; network-enabled retry passed.
Original config uses10539; a fresh config must explicitly record10530 and an
unused playground port. No old report config mutation.

## Product repair proof

SHA-1: real Node24.16.0/npm11.17.0 `npm ci` through an HTTP registry and real
MemoryVfs installation of supplied SHA-1 lock agree. Verified cache hit,
tampered-cache refetch and corrupted-network EINTEGRITY rejection (npm/Rifty).
Vfs cache verifies reads; process-private Eddy cache verifies on put.
`installer-sha1.parity.test.ts`: RED20:49:49 unsupported integrity;
GREEN20:50:09, full35 tests GREEN20:51:59. Revert check reproduces RED for
npm parity/Eddy cache; restored code GREEN. Registry fixture exercises the
real installer without the unavailable cloud registry.

All4 original library inputs/locks installed through real npm-client/MemoryVfs
and RegistryClient public npmjs base; frozen tarball origins npm.yandex-team.ru
unchanged. ms-negative233 packages/8.243s,ms-weeks110/3.579s,
stringify-boxed411/9.514s,queue-clear688/15.582s. Existing optional-peer
warnings retained. [Script/results](agent-eval-pr341-install-proof.json.gz);
executed `pnpm exec tsx /tmp/pr341/corpus-install-probe.ts`. Captured script
imports this worktree by absolute path; extract/adapt imports for another
checkout. Native host installer proof, not fresh browser/model acceptance.

Lifecycle: real SIGINT/SIGTERM during setup/judge retains the started row;
context-close rejection during normal close/failed setup reaps native preview.
`lifecycle.fault.test.ts`:6 RED before fixes, revert checks4+2 RED;
lifecycle + existing series suite10 GREEN (9.60s); interrupted/completed
follow-up59 GREEN (13.72s), agent-bench typecheck/biome PASS.
No model/cloud registry needed. Shared native close owns both teardown paths;
runner persists the row before teardown. Partial rows carry `interruptedAt`,
retain raw observations, omit `completedAt` and unavailable quality estimates;
completed outcomes survive cleanup signals. Timestamp/statistics/label guard
reverts RED. Legacy zero-interruption formats omit new fields/columns.
Offline base/current oracle: eval-v16 report3,010,478/summary72,398/statistics63,617
bytes identical; oldest report657,228/summary20,667 identical. Original gzip
untouched. Native lifecycle fault model recorded
in docs/process/rules/fault-classes.md.
Aliases: [real npm proof](../../npm-client/reference/pr341-npm-alias-repair-evidence.md),
85 GREEN plus four isolated RED revert checks; additional native range-less
override carrier7 GREEN and reviewer mutant RED. Original archive SRI verified;
root/transitive/scoped/override paths, target identities and Eddy harvest/replay.
Separate existing getter-only module.exports failure explicitly captured;
registry install acceptance does not claim every installed CLI executes.

Browser prerequisites: ms-negative reference-control PASS in real COI and
packed no-COI through local npm proxy, no model invocation. Actual setup,
trusted same-origin semantic judge and teardown succeeded; cloud not used.

Source authority follow-up: real npm retained same-version targets on manifest-only
alias↔plain/alias-target edits, including lock names it did not repair.
[ADR-0527](../../../adr/npm-client/0527-retain-npm-alias-source-identity-until-named-install.md)
partially supersedes ADR-0526 after independent DEC-2 probes. Replay preserves
physical/recorded source identity; named install selects the new target, without
borrowing another target checksum. Legacy dist.shasum verifies SHA-1; corrupt
bytes/malformed sums reject.
[Authority proof](../../npm-client/reference/pr341-npm-alias-source-authority-evidence.md):
275 GREEN, restored isolated14 GREEN,6 guard reversions RED. Hash-free fresh LF
SRI remains a recorded generic metadata divergence, not claimed exact.

Fresh96 through corrected proxy: pending; existing historical scores are
never a substitute. Cloud registry availability remains an execution constraint.
