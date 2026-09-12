# AI agent mode FIT evidence

Authority: PR #333 and `ai-agent-mode-refine-evidence.md` (raw request and
four answer rounds, integrator recommendations/acceptance). User hand-off:
«Поставь цель сделать https://github.com/vanilla-wave/rifty/pull/333
Результаты запушь в тот же ПР и доведи до зеленого».

## Baseline

2026-09-12, main `acf594da9`, PR `b7179765959309af0cdefdb8ad1e315fd27bc71e`.

```
git rev-list --left-right --count HEAD...origin/main
2 0
git ls-tree -r --name-only origin/main packages/agent tools/agent-bench apps/playground/src/ai
(empty)
```

PR contains only the accepted draft set; I1–I8 do not exist on main. Public
Workbench/no-COI host substrates and react-vite starter are reused, per refine
evidence. Tier `works` adds no unaccepted scope. The stale frontmatter's
"two-lane" becomes "three-lane", matching the recorded no-COI lane answer.

## Scope attribution

- I1/I2: Outcome + scenarios 1/2; user Workbench answer and integrator 1/2.
- I3: integrator 3's five recovery clauses, quoted in refine evidence.
- I4: carried #111 decisions, core draft Context; no chat persistence added.
- I5: scenario 1, accepted +chat/key decisions and playground draft.
- I6: scenario 3, integrator 4; resident exit remains agent-owned substrate.
- I7: accepted integrator 5 deterministic embedding scenarios.
- I8: scenario 4, three-lane user answer and bench draft Context/Decisions.

The real no-auth endpoint/model was requested in-session for the carried
manual live-streaming acceptance; deterministic preparation is independent.

## Final written-result check

`final-check: 2026-09-12 — clear`, fresh read-only `/root/fit_review`, reviewed
`5d46fb9debeb067a014bbdc3ac464dbf4a665fe4`. Entire goal/map/ledger + four drafts,
raw refine sources and carried PR #111 conditions checked. No new material fork
or attribution error; tier retains recovery obligations. Resident exit stays
technical fog; a test stopping at that gap cannot close I6. `pnpm docs:check`+PASS. This is RDY-6's written-result check, not product Final+GREEN.

User supplied `~/codex-proxy.mjs` and authorized repairs if needed. It started
at `http://127.0.0.1:10530/v1`; model `gpt-5.6-sol`, real streaming request
"Reply with exactly PROXY_OK." returned HTTP 200, `PROXY_OK`, terminal
`finish_reason: stop` and `[DONE]`. No key supplied. Full agent/tool proof remains.
