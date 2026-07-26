# ADR 0323: Gate heavy PR tests on code-affecting changes

Status: Accepted
Date: 2026-07

> TL;DR: classify every PR with a first-party merge-base diff; run unit,
> parity, e2e, and browser-unit only for code-affecting changes, while one
> stable CI gate remains suitable for branch protection.

## Context

Docs-only PR #177 changed one backlog Markdown file but ran 14 test jobs:
2 unit/parity plus 12 browser/e2e, totaling 3,091 runner-seconds. Its useful
lint/docs gate failed while every heavy test passed. Some compatibility/ADR
honesty guards nevertheless lived inside the full unit run, so they cannot be
dropped with that matrix.

`pull_request.paths-ignore` is unsafe for a required workflow: GitHub leaves
the absent check pending. Job-level conditions conclude skipped jobs
successfully, but a false condition is evaluated before matrix expansion, so
matrix child names disappear. Requiring a child such as
`unit-and-conformance (run)` would therefore hang a docs-only PR.

## Decision

1. `CI` still triggers for every PR. A dependency-free `change-scope` job
   compares the event's base/head SHAs from their merge base with
   `git diff --name-only -z --no-renames BASE...HEAD`.
2. Only `docs/**` and conventional documentation files (`README.md`,
   `README.mdx`, `CHANGELOG.md`, `LICENSE`, `LICENSE.md`, `LICENSE.txt`,
   contributor/security docs, `AGENTS.md`, `CLAUDE.md`) are
   documentation-only. Any other or mixed path is code-affecting.
   `--no-renames` exposes both sides of source→docs moves. Empty or failed
   classification fails open to the heavy gate.
3. `unit-and-conformance`, `e2e-chromium`, and `browser-unit-chromium` run only
   for code-affecting PRs. Lint, typecheck, build, backlog, reference,
   generated-compat drift, and the focused source↔compat/ADR contract tests
   remain unconditional.
4. Pushes and merge groups always receive the full gate. One non-matrix
   `CI gate` runs with `always()`, accepts skipped heavy jobs only for a
   docs-only classification, and fails on every failed/cancelled dependency.
   If branch protection is enabled, require only `CI gate`, never matrix child
   contexts.

## Consequences

- Docs-only PRs avoid 14 test runners without weakening their documentation
  integrity checks; the focused contracts reuse the already-installed
  lint-job dependencies.
- Code PRs add one checkout-only classifier before heavy jobs; lint stays
  parallel with it.
- The allowlist is deliberately narrow: unknown config/content changes spend
  test capacity instead of silently weakening coverage.
