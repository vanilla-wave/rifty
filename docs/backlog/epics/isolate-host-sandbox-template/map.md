# Map — isolate-host-sandbox-template

Design: ADR-0572 (Proposed). Probes: `docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/`.

## Items

Children are seeded when the carrier runs (README §FIT 5); planned order, each a hypothesis until
the carrier hits it:

1. Acceptance carrier — the User scenario as an e2e over a real `produceDependencySnapshot`
   artifact of the four libraries (published `@riftydev/workbench`, as the library probe), committed
   RED (`it.fails`), I1–I10.
2. Binary request frame (absorbs `distribution/isolate-host-binary-request-frame`): the template
   goes to a worker once, as bytes; base64 inside a JSON line is +33 % and a ~90 MB string.
3. Template intake in the consumer: artifact → decoded template (gzip/br, ustar + PAX), named
   refusals, identity, a process registry by id, one shared buffer per process (I1, I4).
4. Materialization (ADR-0572 §2): the template as views of one buffer, the difference over it,
   the capture walk emitting the difference and deleted template paths; in the guest and for host
   ops; writable and read-only (`EROFS`) modes; the changed-paths list (I2, I3, I6).
5. Host ops and the cap over the difference only (absorbs
   `distribution/isolate-host-sandbox-write-cost-per-state`) (I4, I5).
6. Worker template cache: by identity, in the RSS ceiling and idle watermark, evicted with the
   worker (I4).
7. The end state taken where the guest's code cannot reach (absorbs
   `distribution/isolate-host-sandbox-capture-outside-guest-realm`; mechanism at its PICKUP,
   ADR-0572 §8) (I7).
8. `snapshot()` / `createSandbox({ snapshot })` over a template → named gap; README cost table
   (~1 MB vs ~95 MB template), compat rows (I5, I8).

## Open questions

- The process registry's lifetime: unregistering or evicting a template (a long-lived consumer
  that rebuilds its template keeps every old version, ~90 MB each) — owner: agent — settled at item
  3's PICKUP (an explicit release or one held while a sandbox references it), I4 documented.
- The guest's sync-only FS (ADR-0572 §2) rests on the user's `createReadStream` track (on top of
  PR #434, open) — owner: agent — settled when it lands; before, materialization targets the
  `MemoryFsSync` the guest entry installs, whichever async pairing it has.
- Template mtimes: the artifact's tar records 0 for every entry (`dep-snapshot-tar.ts` `headerFor`);
  what `fs.statSync` of a template file reports vs `npm ci` (1985-10-26 from npm's tarballs) —
  owner: agent — probe against `npm ci`, then a compat row or the oracle's value.
- The four libraries' `require` in the guest (scenario steps 3, 9) — owner: agent — library probe
  (PR #430, `reference/isolate-library-probe/README.md`, @ b3731e9c0): `pdf-lib`, `docx` load and
  write as Node; `pptxgenjs` stopped on `node:https` at load (loading fixed: PR #435, merged); `require('exceljs')`
  stops on `node:zlib` at require (`isolate-host.zlib`, declared ❌) — owned by the user's thread «Расширить платформу для офисных библиотек» (engine choice pako / wasm zlib / host bridge; isolate load of zlib in its queue), no item here: the
  carrier stays RED on exceljs until the isolate guest has `node:zlib` (rifty builds it on web
  `CompressionStream`, compat isolate-host `:28`: a `CompressionStream` in the guest or zlib on
  another engine — that track's engine choice). No ceiling Web API broke a measured write route;
  reading a file through a stream needs web `ReadableStream` on rifty's own fs path
  (`distribution/isolate-host-fs-read-stream-needs-web-readablestream`, closed by the user's
  `createReadStream` track: the guest's FS becomes sync-only, ADR-0572 §2); routes
  past the first stop (exceljs main after zlib, its streaming writer/reader) are unmeasured;
  `require()` of an ESM-only package needs `URL` (`runtime-js/isolate-require-esm-syntax-gaps`),
  met on no measured path (docx bundles its own `nanoid`), and the consumer asks CommonJS only. A
  dependency of this goal, not its scope.

## Out of scope

- Guest APIs the libraries need (`node:zlib`, `node:https` load, stream hooks, `process.umask`, fs stream `close`; library probe PR #430): their own items / PRs #432–#436 (#432, #433, #435, #436 merged; #434 open); Web API shims: ROADMAP M14 E.
- Building the artifact inside the guest (`npm` in the isolate); a template made by anything but
  `produceDependencySnapshot`.
- The agent tool set over the sandbox: `epics/isolate-host-agent-tools`.
- `exec`'s `signal`: `distribution/isolate-host-sandbox-exec-abort-signal` — landed, PR #431.
- npm publication: `epics/isolate-host-npm-delivery`.
- Templates shared across consumer processes or machines (one copy per process, one per worker).
- Persisting a template sandbox (`snapshot()` / `createSandbox({ snapshot })` over a template, a
  diff-only format, restore by template identity): `distribution/isolate-host-sandbox-template-snapshot`
  (user 2026-11-25).
- Lazy template reads (memory and latency independent of the template): deferred,
  `distribution/isolate-host-sandbox-template-lazy-read` (user 2026-11-25).
- The worker owning the run's whole FS; keeping a killed run's writes:
  `distribution/isolate-host-sandbox-killed-run-partial-writes` (user 2026-11-25).
