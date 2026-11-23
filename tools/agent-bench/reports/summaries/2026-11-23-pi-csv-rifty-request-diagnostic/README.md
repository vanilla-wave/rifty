# csv-workflow-v5, rifty lanes — request comparison (not mixed into the series)

Question: in the [upgrade series](../2026-11-23-pi-1.6.0-upgrade/README.md), csv dropped
on the rifty lanes (COI 3→1, no-COI 3→2) while the native lane turned out to be noise
([native diagnostic](../2026-11-23-pi-csv-native-diagnostic/README.md)). Did the model
receive different input from `@riftydev/agent` on pi 1.6.0?

Method: every provider request of the 12 rifty/rifty-no-coi csv trials in both series
(39 base, 38 after). Normalized as codex-proxy forwards them: `developer` and `system`
become one role, tool `strict` dropped.

Model input, same across versions:
- Request parameters: `max_completion_tokens` 8192, `reasoning_effort` medium,
  `store`, `stream_options`.
- Exactly one leading system message per request. Pi 1.6.0 collapses the transcript's
  prompt-state messages on the wire.
- System prompt text, except the date and temp cwd. 2 variants on COI, and the same 2 on
  both versions: preview tools present or not yet present on the first request.
- Tool names, descriptions and schemas.
- Message shapes.
- First user message.
- Tool-result formats. The same call gives the same result; only the budget counters
  (`callsLeft`, `msLeft`) and build output differ.

Differences: none beyond date, cwd, the role and `strict` that the proxy erases, and model-
dependent content. The csv trials had 0 retries and 0 compactions, so PR code after the
series sha (recovery omission, prompt-section nulling) does not touch this path.

Conclusion: the input matches the native lane's, so the rifty csv drop is not attributable to a
change in what the model receives. Per the diagnostic brief, a rerun is not needed when
the inputs are identical, so none was run.
