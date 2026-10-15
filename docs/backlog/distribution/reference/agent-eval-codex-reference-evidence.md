# Native Codex preparation — 2026-10-05

BASE34f905890; native CLI0.159.3, Node v24.16.0.

- Public real execution: `agent-eval-codex-execution-probe.json`, sum module created and Node assertion passed, completion/usage events.
- SIGTERM physical settlement: `agent-eval-codex-sigterm-settlement-probe.json`, exit0, Node tool still alive5s after CLI exit (probe reaped it). Event capture prefix only.
- Full EOF SIGINT: `agent-eval-codex-sigint-settlement-probe.json`, exit1, real Node PID gone;4 events, no completed turn. Actual cancellation path, no new PID ledger/service required.
- `pnpm test:run tools/agent-bench/src/codex-reference.test.ts`:RED Unknown config field codex; no import/typecheck failure.
- `pnpm exec tsx tools/agent-bench/tests/codex-reference.ts`:RED same unknown config through actual bench CLI; retained `/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-codex-reference-K49S5n/cli.log`. Test uses real Codex only after adapter admission; no fake agent loop.
- `pnpm test:run tools/agent-bench/src/proc-output.fault.test.ts`:RED real ordered native pipe bytes, Ж→��. `rg` sweep finds process completion helper, native Pi collector and direct logged-server writer decode independent chunks. No protocol/model mock or sibling package mock.

## GREEN

- `pnpm test:run ...codex-reference.test.ts ...codex-observation.fault.test.ts ...proc-output.fault.test.ts ...series.fault.test.ts ...comparison.test.ts ...redaction.test.ts`:38/38. Added callable loud observation RED before code; real oracle negatives reject failed/completed mix, no completion, corrupt/truncated JSONL and budget-completion rescue.
- `pnpm --filter @riftydev/agent-bench typecheck`:pass.
- `pnpm exec tsx tools/agent-bench/tests/codex-reference.ts`:real task PASS,124.451s,13 tools,206619/2076 reported tokens,3 changed files, common judge passes; actual initial tree equals source task plus installed lock (no seeded operator/answers/config). Separate real1s deadline budget-exceeded,1.022s,0 observed tools, tokens unavailable. Retained compressed bundle `tools/agent-bench/reports/summaries/2026-10-05-native-codex-acceptance/`.
- Full actual3-lane scripted five-task smoke after four-lane selection:1/1,5.7min;14 real Pi-supported runs/28 requests,20 selected records (5 explicit unconfigured Codex +1 no-COI Node setup failure). No implicit paid native participant.
- Committed reference summaries policy4/4: gzip only, Unix header, manifest original artifact sizes/SHA256 exact.
- `pnpm pr:check`:27/27; test:run228.7s, test:parity119.2s. Independent Final+GREEN next on committed source.
