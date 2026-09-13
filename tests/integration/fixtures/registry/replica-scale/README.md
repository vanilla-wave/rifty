# Replica public npm fixture

Original npm archives, captured 2026-09-13; unchanged package contents/licenses.
`registry-fixture.json` retains registry package metadata, upstream SHA-512
integrity and archive file counts. The public-scale fixture validates every
archive before serving it and runs the same program against native Node.

Install roots: `@gravity-ui/icons@2.18.0`, `lodash@4.18.1`,
`lodash-es@4.18.1`, `dom-helpers@5.2.1`, `react@18.3.1`; closure: ten packages,
5,414 archive files. Initial `ms@2.0.0` uses the existing parent fixture.
No lifecycle-script bypass or rewritten tarball. T's separate path/size
manifest uses procedural inert bytes, never claims to execute Tracker.
