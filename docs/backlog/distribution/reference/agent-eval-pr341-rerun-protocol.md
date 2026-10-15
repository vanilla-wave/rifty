# PR341 corrected eval-v16 rerun

Same frozen eval-v16:8 tasks×4 lanes×3 cold attempts,96 selected. Original
prompts/judges/inputs/locks/control payloads unchanged. Limits100 tools/600s;
Pi GPT-6 Luna/medium, native Codex gpt-6.1-sol/low, separate context caveat.
No rescoring, resume, overwrite, native rescue or adaptive subset.

`pilot-comparison.json` uses fixed local proxy10530; playground5398. Transport
preflight4 parallel calls carried4 valid JSON arguments. npm SHA-1/aliases and
interrupted-attempt/native teardown repairs enter the new source revision.

Cloud Rifty registry unavailable. Dev host explicitly uses its existing public
npm proxy: `VITE_RIFTY_REGISTRY_URL=/npm-registry`,
`VITE_RIFTY_EDDY_BUNDLE_URL=''`. Packed no-COI already uses `/npm-registry`.
Supplied lock tarball origins stay unchanged; no fabricated packages/cache or
source aliases. Registry transport differs from history; no environment-only
causal conclusion. Plan/source/config fingerprints measured before model calls.

```sh
VITE_RIFTY_REGISTRY_URL=/npm-registry VITE_RIFTY_EDDY_BUNDLE_URL='' \
  pnpm agent-bench run --suite eval-v16 \
  --config tools/agent-bench/configs/pilot-comparison.json \
  --output /tmp/pr341/eval-v16-corrected
```

Every selected attempt retained, including setup/provider/budget/functional
failures. Classify all rows with evidence before freezing; successes `none`,
unisolated causes stay explicit. Retain malformed-tool metrics and full source/
trace/phase/diff/judge evidence. If environment preflight cannot support the
matrix, record the failed probe and leave clean comparison pending.

Booking/expense judges unchanged until clean native results justify inspection.
Finite profile/I10 catalog remain historical observations with proxy caveat.
