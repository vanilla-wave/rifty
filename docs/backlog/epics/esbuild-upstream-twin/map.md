# Map — esbuild-upstream-twin

## Items

- PR #379 integration: preserve landed no-COI upstream0.28.0 + SW (ADR-0539),
  COI requested ranges, and the generic Node repairs; regenerate both-tier
  artifacts without changing dependency pins. Main's explicit I4 amendment is
  authoritative. Frozen prior goal proof remains in git; reverify the composition.

## Open questions

- Merge with main7f8d0e8d7, combined no-COI/COI proof and final HEAD CI — owner: agent.

## Out of scope

- Real Sync APIs, no-COI multi-version admission, catalog migration and starter-pin retirement.
