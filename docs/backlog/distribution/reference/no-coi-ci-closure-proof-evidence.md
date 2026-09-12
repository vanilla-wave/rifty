# No-COI CI closure proof — evidence (2026-09-04)

## RED

```sh
pnpm test:no-coi \
  -g "no-COI capable dedicated Worker selects OPFS and survives exact-byte reload" \
  --reporter=line
# Error: No tests found; exit 1
```

Baseline `af38b4b5e`; Node 24.16.0, Playwright 1.60.0, Chrome 148. The failure
is exact no-COI test discovery after removing the old browser-unit location,
not import, typecheck or browser setup.

## GREEN

```sh
pnpm test:no-coi \
  -g "no-COI capable dedicated Worker selects OPFS and survives exact-byte reload" \
  --reporter=line
# 1 passed (4.1s), Chrome 148.0.7778.96
# page + both Workers crossOriginIsolated=false; flush clean; fresh Worker exact bytes

pnpm test:no-coi --reporter=line
# 39 passed (3.7m); moved I5 carrier is test 18/39

pnpm exec playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/opfs-no-coi-policy.spec.ts --workers=1 --reporter=line
# 7 preservation/fault siblings passed (4.8s)
```

Committed `check:contract-drift` PASS. Final `pnpm pr:check` PASS 24/24:
`test:run` 219.4s, parity 76.7s. Remote `no-coi-chromium` PASS 39/39 at
`b7fd5802f`.

First post-re-cut `pnpm pr:check`: 23/24; `test:run` 213.0s and parity
76.3s passed, only one formatter diff in the reverted CI contract test failed.
`pnpm lint` passed after the mechanical blank-line fix; the final gate above
supersedes this intermediate run.

Ordinary proof-only review @ `b7fd5802f`: product delta 0; 3/3 coverage pass;
0 blockers / concerns / nits; unit and goal residuals 0.
