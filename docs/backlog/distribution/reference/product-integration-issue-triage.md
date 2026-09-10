# Product integration issue triage

Initial assessment below predates the user's first-group refinement answer.
Current first-group destination: `docs/backlog/epics/no-coi-self-hosted-project/goal.md`.
ADR-0417 replaces the proposed installation-trust/forced-retry direction with
ordinary saved access and explicit snapshot application. Second group stays draft.

2026-09-10. User: «Посмотри issue по результатам встраивания rifty в продукт,
оцени насколько она валидны/нужны и придумай как их сгруппировать чтобы сделать
за пару итерация(мб и за одну, если оно похожее)». No implementation request or
additional scope answers. Baseline: `2c7f9bbf4` (includes #316 and #321).

## Sources and assessment

GitHub open issue bodies retrieved with `gh issue list --repo vanilla-wave/rifty
--state open --limit 100 --json number,title,body,url`; #316/#321 descriptions
read with `gh pr view`. New reports explicitly describe a static published-0.7.0
audit. Current-source inspection confirms the missing SDK interfaces, not the
downstream integration's timings or an independently reproduced browser defect.

| Issue | Assessment on this baseline | Evidence |
|---|---|---|
| [#325](https://github.com/vanilla-wave/rifty/issues/325) | Needed: ordinary FS API. Structured eval is an explicit alternative, not automatically required. | runtime-js/src/host.ts RuntimeFs; protocol.ts FsRequest; worker-entry.ts handleEval prints value and returns undefined |
| [#326](https://github.com/vanilla-wave/rifty/issues/326) | Needed: real command ownership, output and Stop settlement. Highest uncertainty/effort of the five. Dedup into existing exec draft. | rifty/src/sandbox.ts SandboxToolchain; runtime-js/src/protocol.ts run-bin and untagged stdout/stderr; workbench/src/workers/no-coi-toolchain-worker.ts runInstalledBin |
| [#327](https://github.com/vanilla-wave/rifty/issues/327) | Needed: published snapshot consumer for SDK. Producer and warm open alone cannot replace private archive extraction. | workbench/README.md producer/application policies; no-coi-toolchain-worker.ts installationSlug/openInstallation; protocol.ts requires registryUrl |
| [#328](https://github.com/vanilla-wave/rifty/issues/328) | Needed: select namespace/persistence before authoritative preload. | rifty/src/sandbox.ts options; runtime-js/src/worker-entry.ts boot; workbench/src/workers/owner-storage.ts existing policy |
| [#329](https://github.com/vanilla-wave/rifty/issues/329) | Needed: SDK startup budget independent of Workbench budgets and hydration optimizations. | runtime-js/src/host.ts fixed 10,000ms handshake; rifty/src/sandbox.ts initial boot/restart |
| [#259](https://github.com/vanilla-wave/rifty/issues/259) | Original deployment gap addressed by #316's copyable asset alternative. Candidate for closure after consumer verification; custom bundling claim is not disproved. | workbench/README.md Static runtime assets; tools/publishing/build-workbench-assets.mjs; ADR-0390 |
| [#281](https://github.com/vanilla-wave/rifty/issues/281) | Partly remains: Workbench still requires sqlite URL. Host sql.js pin/copy workaround superseded by packaged sql-wasm.wasm. Optional bytes input is optional scope. | workbench-options.ts required wasm.sqlite; node-worker-runtime-config.ts required sqliteWasmUrl; build-workbench-assets.mjs copies pinned asset |
| [#247](https://github.com/vanilla-wave/rifty/issues/247) | Old aggregate, mostly addressed; reconcile individual rows before closing, not a new runtime batch. | d34577d54; ADR-0346/0348; npm-lock-replay.spec.ts failing-build coverage; current changelogs |

Paths in the table omit `packages/` when naming a package. #247 detail:
path.join trailing slash repaired; require(ESM) now supported (original Vite
config matrix not rerun here); snapshots carry replay-cache bytes; persist timers
start on execution and flush has real-settlement behavior; unresolved-import
coverage asserts command failure then owner alive; impossible live-run test was
replaced by install-only coverage in d34577d54. These source/history findings are
not a claim that the original full React/Gravity project was rerun.

## Delivery recommendation

1. #328 + #329 → #327: host-configured boot, persistent snapshot materialization
   and saved open. Reuse existing VFS/storage, snapshot and stamp authorities.
   Result: packed producer → copied no-COI worker → real Vite build → edited
   project reload/open/build with zero registry traffic and preserved source.
2. #325 + #326: project files and commands. Share root/policy/mutation/recovery
   contracts. Result: public file CRUD → run/output → Stop → next run, including
   failed build and interruption during writes.

Two iterations are a recommended packaging boundary, not a duration estimate.
One overall effort/PR can contain both; no need for five independent projects.
One small implementation session is not supported by this audit: snapshot
identity and forced-stop recovery require new public contracts and real fault
proof. #281's optional sqlite config is a smaller independent Workbench residual;
do not make it a no-COI dependency. #259/#247 need issue reconciliation, not another
copy of landed work. No issue comments, closures or edits are authorized here.

## Alternatives and assumptions

- Use Workbench directly: viable only where its COI requirement is acceptable;
  open-workbench.ts assertEnvironment still rejects without COI. The reported
  existing-app/no-COI scenario cannot take that shortcut (ADR-0377).
- Custom globals, eval/temp-file RPC and private snapshot extraction reproduce
  owner logic in each host; the five issues remove that concrete integration cost.
- Preserve #325's two eval alternatives; recommend documenting console eval
  while exposing structured file/command operations. No user choice recorded.
- Namespace is addressing, readonly is operation policy, required OPFS rejects
  volatile fallback. None promises security isolation, eviction protection or
  rollback. Same-namespace concurrent ownership stays outside #328's request.
- Proposed groups are draft. Names, result bounds and exact API remain open;
  no ready goal or accepted invariant is amended by this assessment.

## Dedup

Checked distribution drafts, epic maps/links, code references, process traps and
ADR index declined concepts. #326 matches public-api-ai-agent-exec-preview;
#325 CRUD and #327–329 boot/snapshot have no matching active item. Whole-sandbox
snapshot/restore/fork is a different artifact. The COI React embed-host epic
remains separate. Existing owner/command/recovery mechanisms must be inventoried
at pickup before adding coordination; no new mechanism is prescribed here.

## Initial grouping Challenge

Fresh read-only `/root/integration_critic`, original issue bodies and code:

> Вердикт: ценность подтверждается; две группы разумны. Одна итерация возможна как упаковка, но сходство issues не сокращает основную сложность #326.

Verified observations: Workbench requires COI; Shell abort can detach a still-live
handler; blocked same-realm guest code cannot receive Stop; SDK recovery tracks
public writes more narrowly than command mutations. The first group's later
user-selected policy supersedes this critic's installation-stamp recommendation;
the second group's lifecycle risks remain questions, not implementation promises.
