# Changelog

## [Unreleased]

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
