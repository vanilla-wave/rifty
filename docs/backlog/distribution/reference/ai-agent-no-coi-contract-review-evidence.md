# Independent no-COI Contract+RED review

Reviewer `/root/no_coi_contract_review`, fresh context, no children, read-only tracked tree.
BASE core Final+GREEN `523628b0cc4828e4ae802445e683f84a7f0359cc`.
Initial clean HEAD `7a0202a9d2e9f6c5e87490f2a0fdba375842faa0`.
Authority: accepted goal/map, raw refine/FIT source, ADR-0377/0418/0424/0426.

## Executed independently

- `pnpm exec playwright test -c playwright.no-coi.config.ts tests/no-coi/no-coi-pi-agent.spec.ts tests/no-coi/no-coi-resident-exit.spec.ts`
  `/tmp/pr333-no-coi-reviewer-red.log`: five intended API-stub RED, zero timeouts.
  Four `agent.sandbox-host`, one `sandbox.stopResident`. Resident carrier already starts real HTTP server and proves restart replay before missing exit.
- `pnpm exec playwright test -c playwright.no-coi.config.ts tests/no-coi/no-coi-agent-sdk.spec.ts`
  `/tmp/pr333-no-coi-reviewer-sdk.log`: 5/5 PASS, 7.0s. Actual rooted file policy, invocation cwd/env/output stream, OPFS failure, pending-flush Stop and forced Worker replacement.
- Copied retained consumer into `/tmp/pr333-no-coi-reviewer-consumer`. Rebuilt current `packages/agent/src/index.ts` and `packages/rifty/src/index.ts` with esbuild into only the copied installed package JS (`bundle:true, packages:external, format:esm, platform:browser, target:es2022`). Copied current shared scenario, packed entry and Vite config. No new tarball/declaration proof claimed.
- In copied consumer: `node node_modules/vite/bin/vite.js build`; `/tmp/pr333-no-coi-reviewer-packed-build.log`: PASS, 1275 modules, 2.33s, new noCoiAgent entry emitted. Restored original producer-vite snapshot JSON/tar.gz after Vite cleaned dist.
- `node --input-type=module` importing current `provePackedNoCoiPiAgent` and calling it with copied consumer. `/tmp/pr333-no-coi-reviewer-packed-red.log`: public packed entry imports, SW/Worker boots, exact snapshot activates, then intended `NotImplementedError: agent.sandbox-host`. This is prepared entry/RED proof, not complete packed GREEN or a new tarball installation proof.

## Criteria and scope

Compared changed Vite prebundle includes, Rollup entries, SW allowance and unconditional packed journey call with actual BASE source. All additive; previous criteria retained. No gate/test weakened. Read all current unit changes including scaffold, typed API, ADR, map/ledger updates. Goal destination unchanged. No adapter/replacement implementation present before review. Model is the only fake in new scenarios; file/shell/Worker/preview substrates are real.

## Fixture error found during review

Driver observed edit_file's wrong argument spelling while reviewing in parallel; reviewer independently verified actual native validation. Source schema is copied verbatim from packages/agent/src/tools.ts; args copied verbatim from sandbox-agent-proof.ts, not reconstructed from the driver's diagnosis.

```
node --input-type=module
import { readFileSync } from 'node:fs';
import { Type, validateToolArguments } from './packages/agent/node_modules/@earendil-works/pi-ai/dist/index.js';
const source = readFileSync('packages/agent/src/tools.ts','utf8');
const fixture = readFileSync('tests/integration/fixtures/workbench-vite-consumer/src/sandbox-agent-proof.ts','utf8');
const schemaText = source.match(/'edit_file',[\s\S]*?(Type\.Object\([^\n]*\))/)[1];
const argsText = fixture.match(/name: 'edit_file',\s*args: (\{[^\n]*\})/)[1];
const parameters = Function('Type', `return ${schemaText}`)(Type);
const args = Function(`return (${argsText})`)();
validateToolArguments({name:'edit_file',description:'Native actual schema probe',parameters}, {type:'toolCall',id:'probe',name:'edit_file',arguments:args});
```

`/tmp/pr333-no-coi-reviewer-edit-schema.log`, Node v24.16.0/Pi 0.85.1:
`Validation failed for tool edit_file: old: must have required properties old, new`.
Changing only oldText/newText keys to old/new validates. Initial report updated before hand-off; saved `/tmp/pr333-no-coi-contract-review-before-fixture-fix.json`. The current missing-adapter RED masks this later fixture validation failure. Expected saved/search assertions must remain unchanged.

Two advisory observations in the original report: explicitly assert Stop uncertainty/skipped calls in exported events; compare direct SDK outcome/stream/cwd-env semantics with adapter invocation. No executed surviving mutant for these; advisory only, coverage pass under REV-4/5.

Goal residuals remain current no-COI implementation/GREEN, playground UI/live proof, three-lane benchmark. No goal closure claimed.

## Scoped verification of accepted repairs

Clean HEAD f9593e5e8f472dba51041a70d2345ff7019b0d3c; production remains the same two named NotImplementedError stubs. Actual diff inspected against initial reviewed tree: native old/new names, unchanged expected saved/search/policy outcomes; one additional prior cd/export invocation explains tool-result/history count changes; direct SDK invocation now supplies the exact completion and stdout/stderr stream oracle. Native readonly error facts are compared. Stop native tool_execution_end details/isError are checked against retained outcome, including forced-Worker uncertainty. Both original NOTE observations addressed.

Re-executed the native schema extraction/validation using actual committed corrected args. /tmp/pr333-no-coi-reviewer-edit-schema-verify.log: Node v24.16.0, Pi 0.85.1, actual committed args valid {path:'src/created.txt',old:'retained',new:'saved'}. The invalid-fixture blocker is repaired; original report remains history, not adjudicated away.

Re-ran the same five browser specs at this exact clean HEAD: /tmp/pr333-no-coi-reviewer-verify-red.log, four agent.sandbox-host plus one sandbox.stopResident, zero timeouts. Existing native SDK 5/5 result remains applicable: no product source changed. Copied-consumer packed entry/RED result remains applicable to unchanged cycle and public scaffolding; no new packed installation/GREEN claim.

Final /tmp/pr333-no-coi-contract-review.json: PASS, 17/17 coverage, zero findings and unit residuals, reviewed_sha f9593e5e8f472dba51041a70d2345ff7019b0d3c. Driver continues IMPLEMENT and full goal; I5/current no-COI GREEN/I8 remain goal residuals. Tracked tree left clean.
