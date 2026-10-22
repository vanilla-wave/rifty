# Ledger — honest-substitution-signals (append-only)

- 2026-09-27 — FIT from the shadow-registry retro intake (review 2026-08-04, session 7dd8ff93; re-verified on `99fdf6c91`); evidence: `docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md`
- 2026-10-20 — upstream-twin cutover (PR #379, ADR-0543) supplies COI facade types pointing at unchanged twin declarations. Item 3 keeps legacy no-COI declarations and TS/IDE resolution proof. The separate catalog-name draft is retired: tier-disjoint selectors valid, overlaps rejected at decode.

- 2026-10-22 — pickup at c39266974; user authorized whole goal in one PR, explicitly no merge. Acceptance carriers cover all four existing children together before implementation; unchanged premise reused.

- 2026-10-22 — Contract+RED accepted @ 095810e2b (PR #383); reviewer caught wrong automatic-carrier public cwd, corrected and independently rerun. All I1–I4 REDs discriminate; composed Vite7 path added. I2 Node24.16.0/TS5.9.3 native and VFS service proof closes own-types fog. Implementation begins.

- 2026-10-22 — I1/I4 focused checks 44/44; I2 + existing COI suite 34/34; lightningcss page/probe 2/2 + install/acquisition 39/39. Catalog regenerated. Snapshots re-attested through builtin recipe factory/receipt writer, then `pnpm snapshots:bake -- --replay-committed-lockfile` passed; comparison against c39266974: every lock.packages entry and tarballCache byte unchanged; only esbuild/package.json changes in vite/typescript payloads, vite8 payload unchanged.
