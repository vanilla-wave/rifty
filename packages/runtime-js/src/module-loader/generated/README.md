Pinned upstream compiler, browser-scoped by ADR-0381. Inspect the generator,
not the minified artifact. `pnpm eval-compiler:generate` writes;
`pnpm check:eval-compiler-drift` verifies exact bytes and provenance.
