# `diamond-conflict-parent` — synthesized fixture (ADR-0021 / ADR-0042)

This is a hand-rolled, locally-synthesized npm package vendored to support
`tests/integration/nested-install.test.ts`. It exists because:

1. ADR-0021 forbids in-memory tar-builder mocks in integration tests; we need
   a real `.tgz` archive on disk.
2. ADR-0042's nested-install regression detector needs at least one parent
   that depends on `ms@2.0.0` exact (so it conflicts with the `^2.1.3` chain).
3. Every realistic candidate on the public registry (`finalhandler`, `morgan`,
   `body-parser`, …) drags in too many transitive deps to vendor cheaply.

A locally-synthesized wrapper sidesteps that: 613 bytes of real tar + a
single declared dependency.

## Refreshing the tarball

Run from this directory:

```bash
npm pack
cp diamond-conflict-parent-1.0.0.tgz \
   ../../../tests/integration/fixtures/registry/
# then update tests/integration/fixtures/registry/manifest.json and
# diamond-conflict-parent-1.0.0.json with the new sha256 integrity
python3 -c "import hashlib,base64; print('sha256-'+base64.b64encode(hashlib.sha256(open('../../../tests/integration/fixtures/registry/diamond-conflict-parent-1.0.0.tgz','rb').read()).digest()).decode())"
```

The on-disk tarball is the source of truth; the source files in this
directory are kept for reproducibility (so future maintainers can re-pack
without spelunking through git history).

## Why not just write `tools/integration-fixtures/refresh.ts`?

That's tracked separately on the M11 backlog (ADR-0021 §"Implementation
notes 2026-05-24"). This README documents only the manual re-pack
flow for the synthesized fixture; the broader refresh script (which would
also re-download `ms`, `debug`, `picocolors`, etc. from the live registry
and verify upstream SHA-512s) is its own task.
