# Changelog

## [Unreleased]

- Load frozen real-project/app corpora; validate hashes/v3 locks/family split; run private command judges in each origin and retain non-model controls separately (ADR-0506).

- Add real isolated native Codex reference, explicit settings/version, terminal protocol validation, SIGINT budgets, retained raw errors and unknown telemetry; all selected lanes remain visible. Preserve native UTF-8 across chunks and raw log bytes.

- Resolve full selected series before setup; reject occupied outputs, retain partial/missing trials on interruption and atomically persist completed records before cleanup. Report regeneration is read-only over JSON; unsupported selected trials remain failures (ADR-0505).

- Shared reference host uses explicit preparation/open, with no snapshot deployment policy (ADR-0490).

- Keep existing benchmark preview by registering its SW only on preview; default packed CI runs the shared-host smoke with real Vite.

- Boot the exact packed reference-host module in no-COI, connect agent registry installs, adopt100-call defaults and expose per-capability/text-only toggles. Record optional no-COI policy settings in report/comparison identity (ADR-0489).

- Commit summary JSON artifacts as gzip; report-written JSON gets a normalized header (mtime 0, OS byte 0x03), deflate stream identical per zlib build (not proven across OS); frozen `source-artifacts.json.gz` bundles keep their measured bytes, manifest sizes/SHA256 test-checked; `report`/`--compare` read plain or gzip and write back in the directory's format.

- Count successful core compactions only; failed summary attempts no longer inflate the benchmark counter.

- Compare fixed-config recorded runs with exact identities, per-task/lane metric deltas, preserved provenance and visible regressions.

- Preserve JSON numbers and native protocol tags during credential redaction; derive every lane's metrics from live events before masking payload strings.
- Keep generated report addresses/revisions valid while masking credential-bearing payload keys, including filenames.

- Accept native catalog endpoint/defaults in every lane; report full input/output tokens, continuation/tool-failure counters and separate context-exceeded outcomes.

- Migrate browser lane session creation to native pi model catalogs.

- Reuse the packed-consumer installed-tarball registry helper; drop unused process helpers.
- Run three cold Pi lanes with common React/Hono judges, optional auth, real admission/deadline limits, retained diagnostic artifacts and manual failure classification.
- Verify smoke through an external HTTP observer and real browser trace actions; validate judges against native positive controls.
