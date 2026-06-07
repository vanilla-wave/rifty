# Backlog — content-addressable dependency store + VFS link layer

A **pull backlog** for the one current-generation install optimization rifty lacks vs pnpm: a **content-addressable store of UNPACKED package files** (+ optionally a VFS link layer so placements REFERENCE store entries instead of copying bytes). Seeded by the 2026-06-07 review's "npm/yarn-classic, not pnpm" finding.

- **IDs:** `DS-n`. **Status:** `done` · `accepted` · `idea` · `deferred` · `blocked`. **Size:** S/M/L.

## Why this exists (the gap)

rifty today follows the **npm-v3 / yarn-classic** model: copy bytes into each `node_modules` placement, no cross-project dedup, no link layer (ADR-0050: VFS has no symlink/hardlink). Two concrete costs the code shows:

- **Extraction is re-done per placement AND per install.** `fetchAndUnpackToCache` returns RAW gzip bytes; `extractTarGz` (gzip-inflate + tar-parse) runs in `pinToPackage` for EACH installPath, and the tarball cache (ADR-0023) stores GZIP bytes — so a re-install or a second project re-inflates every package from scratch. The perf audit names main-thread inflate/tar-parse as the **install ceiling** (`docs/perf/js-runtime-perf-audit-2026-06-05.md` §7).
- **Bytes are copied into every placement.** `linker.ts` `vfs.writeFile`s each file per placement; duplicate placements of one version (flat + nested) and every separate project each hold their own copy. No cross-project sharing (pnpm's superpower).

The network side is already solved (in-flight dedup + integrity tarball-cache). The *unpacked* side is not.

## Expected gain (honest — the "how much faster?" answer)

**Do NOT expect pnpm's headline "2–3× cold install".** rifty's cold path is bounded by one-time network + one-time extraction per unique package — a store can't skip the FIRST inflate, and on the in-memory backend a byte "copy" is a cheap `Map.set` of an existing buffer. So:

| Scenario | Expected change | Why |
|---|---|---|
| **Cold first install, single project** | ~0–10% | Every unique pkg still fetched + inflated once; in-memory copy already cheap. Not a speed play. |
| **Warm re-install / 2nd project, overlapping deps** | **potentially multi-× (the real win)** | Network already cached; today extraction RE-RUNS every install. An integrity-keyed UNPACKED store (DS-2) skips inflate+tar-parse — the audit's named ceiling — so warm install drops toward link/copy time. Magnitude = inflate's share of total; **measure (DS-1/PB-5) before claiming a number.** |
| **Duplicate placements within one install** | modest | Skip re-extract of the same integrity at a 2nd path; usually few dups. |
| **Memory footprint (in-memory VFS)** | real reduction (footprint, not latency) | DS-3 link layer shares one buffer across duplicate placements + projects — matters for browser-tab memory limits. |
| **OPFS persistent backend** | write-I/O + cross-session | DS-3 cuts real per-file write syscalls for duplicates; a persisted store (DS-4) survives reloads = pnpm "global store" analog. |

**Bottom line:** the cheapest, highest-value piece (DS-2, unpacked-content store) needs **no link layer at all** — it just memoizes `extractTarGz` output by integrity, killing the re-inflate ceiling on warm/cross-project installs. The symlink/hardlink layer (DS-3+) is a **memory/disk + cross-project** play, not a cold-speed play, and carries copy-on-write risk. Size everything off DS-1.

## Items

- **DS-1 — install cost breakdown profile (gate for everything).** `accepted · S-M`. Instrument one cold + one warm install (express/vite fixture) per backend (MemoryBackend, OPFS): wall-clock split across network / `extractTarGz` inflate+tar-parse / `vfs.writeFile` / overhead. This is the ONLY way to size DS-2/DS-3. Ties to PB-5. **Until this runs, every magnitude above is a hypothesis.**
- **DS-2 — integrity-keyed UNPACKED-content store (no link layer).** `accepted · M`. Cache the extracted `{path→bytes}` map keyed by SRI integrity (alongside or replacing the gzip tarball-cache), consulted in `pinToPackage`/linker. Skips re-inflate on a 2nd placement and on re-install/cross-project. Highest ROI, lowest risk — does NOT touch ADR-0050. Persist in OPFS for cross-session reuse (overlaps DS-4).
- **DS-3 — VFS link/indirection layer (placements reference the store).** `blocked · L`. A VFS node that points at a store entry instead of holding bytes (hardlink/symlink analog) so duplicate placements + cross-project deps share one buffer. **Requires extending/superseding ADR-0050** (no-symlink) → IRREVERSIBLE, needs an ADR. Cuts memory (in-memory) and write I/O (OPFS).
- **DS-4 — persistent cross-session OPFS store.** `idea · M`. The pnpm "global store" analog: persist the DS-2 unpacked store (and/or DS-3 links) across page reloads/sessions so a returning user skips inflate entirely. Depends on DS-2 (and DS-3 for sharing).
- **DS-5 — copy-on-write correctness guard (prerequisite for DS-3/DS-4).** `accepted · M`. A guest `fs.writeFileSync` (or chmod/rename) into a linked `node_modules` file MUST copy-on-write, never mutate the shared store entry — pnpm gets this free from the OS + hardlinks; rifty must do it explicitly in the VFS. Without this, DS-3 is a correctness landmine (one project corrupts another's dep). Add an aliasing test mirroring the OPFS single-slice guard.

## Recommended first pull
**DS-1 → DS-2.** Profile first (no number is honest without it), then ship the unpacked-content store — the warm/cross-project speed lever that needs no link layer and no ADR. **DS-3/DS-4/DS-5 only if DS-1 shows write/copy + memory are a meaningful fraction AND the cross-project/footprint win justifies the COW complexity** — otherwise the store (DS-2) captures most of the realistic gain.
