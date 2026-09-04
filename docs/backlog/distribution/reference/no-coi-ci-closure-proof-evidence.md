# No-COI CI closure proof — evidence (2026-09-04)

## RED

```sh
pnpm exec vitest run --project unit \
  tools/checks/ci-change-scope.test.ts --reporter=dot
# 1 failed / 5 passed
# expected no-coi-chromium to contain the exact I5 carrier command
```

Baseline `7415759eb`; Node 24.16.0, Vitest 2.1.9. The failure is CI selection,
not import, typecheck or browser setup.

## GREEN

```sh
pnpm exec vitest run --project unit \
  tools/checks/ci-change-scope.test.ts --reporter=dot
# 6 passed (538ms)

pnpm exec playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/opfs-no-coi-policy.spec.ts \
  -g "no-COI capable dedicated Worker selects OPFS and survives exact-byte reload" \
  --workers=1 --reporter=line
# 1 passed (4.2s), Chrome 148.0.7778.96
# page + both Workers crossOriginIsolated=false; flush clean; fresh Worker exact bytes

pnpm test:no-coi --reporter=line
# 38 passed (3.8m)

pnpm pr:check
# 24/24 PASS; test:run 212.8s; parity 79.8s
```

Ordinary review and remote job pending.
