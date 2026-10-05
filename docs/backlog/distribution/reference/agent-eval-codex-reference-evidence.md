# Native Codex preparation — 2026-10-05

BASE34f905890; native CLI0.159.3, Node v24.16.0.

- Public real execution: `agent-eval-codex-execution-probe.json`, sum module created and Node assertion passed, completion/usage events.
- SIGTERM physical settlement: `agent-eval-codex-sigterm-settlement-probe.json`, exit0, Node tool still alive5s after CLI exit (probe reaped it). Event capture prefix only.
- Full EOF SIGINT: `agent-eval-codex-sigint-settlement-probe.json`, exit1, real Node PID gone;4 events, no completed turn. Actual cancellation path, no new PID ledger/service required.
- `pnpm test:run tools/agent-bench/src/codex-reference.test.ts`:RED Unknown config field codex; no import/typecheck failure.
- `pnpm exec tsx tools/agent-bench/tests/codex-reference.ts`:RED same unknown config through actual bench CLI; retained `/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-codex-reference-K49S5n/cli.log`. Test uses real Codex only after adapter admission; no fake agent loop.
- `pnpm test:run tools/agent-bench/src/proc-output.fault.test.ts`:RED real ordered native pipe bytes, Ж→��. `rg` sweep finds process completion helper, native Pi collector and direct logged-server writer decode independent chunks. No protocol/model mock or sibling package mock.
