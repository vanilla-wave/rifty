# csv-workflow-v5, native Pi only — diagnostic re-run (not mixed into the series)

Question: is the 9/9 → 5/9 csv drop in the
[upgrade series](../2026-11-23-pi-1.6.0-upgrade/README.md) a pi 1.6.0 property?
Lane `local-reference` only (pi CLI, no rifty), same endpoint/limits/config as the
series. 15 fresh trials per version, run one after the other on an otherwise idle
machine. 0.85.1 at clean `11b9397ee` (`pi-0.85.1/report.json.gz`); 1.6.0 at clean
`9709a2b83` (`report.json.gz`).

| Pi CLI | PASS |
|---|---|
| 0.85.1 | 15/15 |
| 1.6.0 | 15/15 |

With the series trials: native 18/18 on 0.85.1 and 17/18 on 1.6.0. The drop goes away,
so it was noise. Request diff (series native csv, every request):
- `max_completion_tokens`, `reasoning_effort`, `stream_options`, `store`: same.
- Prompt text: same except the temp cwd. Tool names, descriptions, schemas and tool-result formats: same.
- Prompt role `developer` → `system`: codex-proxy maps both to one role.
- `strict: false` no longer sent: codex-proxy drops tool `strict`.

The model got the same input on both versions.
