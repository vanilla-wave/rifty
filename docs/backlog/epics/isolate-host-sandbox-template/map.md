# Map — isolate-host-sandbox-template

Design: ADR-0572 (Proposed). Probes: `docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/`.

## Items

Children are seeded when the carrier runs (README §FIT 5); planned order, each a hypothesis until
the carrier hits it:

1. Acceptance carrier — the User scenario as an e2e over a real `produceDependencySnapshot`
   artifact of the four libraries (published `@riftydev/workbench`, as the library probe), committed
   RED (`it.fails`), I1–I10.
2. Template intake in the consumer, with the loud gap of I8 in the same unit (from the first
   `createSandbox({ template })`, `snapshot()` / `createSandbox({ snapshot })` over a template throw):
   artifact → decoded template (gzip/br, ustar + PAX), named refusals, identity and packages, a
   process registry by id, one shared buffer and index per process; host ops over the consumer-side
   overlay (difference + deleted paths), the cap over the difference (absorbs
   `distribution/isolate-host-sandbox-write-cost-per-state`) (I1, I3 host side, I4, I5, I8).
3. Worker template cache + binary request frame (absorbs
   `distribution/isolate-host-binary-request-frame`): a worker receives a template once, as bytes
   (base64 inside a JSON line is +33 % and a ~90 MB string), keeps it by identity in its RSS ceiling
   and idle watermark, evicted with the worker (I4).
4. Materialization in the run (ADR-0572 §2): the template as views of one buffer, the difference
   applied over it, the capture walk emitting the difference and deleted template paths, validated
   by the consumer; writable and read-only modes in the guest; the changed-paths list (I2, I3, I6).
5. The end state taken where the guest's code cannot reach (absorbs
   `distribution/isolate-host-sandbox-capture-outside-guest-realm`; mechanism at its PICKUP,
   ADR-0572 §8) (I7).
6. README cost table (T1, T95, the four-library artifact), compat rows (I5, I10).

## Open questions

- The process registry's lifetime: unregistering or evicting a template (a long-lived consumer
  that rebuilds its template keeps every old version, ~90 MB each) — owner: agent — settled at item
  3's PICKUP (an explicit release or one held while a sandbox references it), I4 documented.
- The guest's FS sync-only (ADR-0572 §2) is an external dependency: PR #437 «isolate guest:
  fs.createReadStream reads files (sync-only guest FS)», open, on top of PR #434 (open); main's guest
  still calls `installMemoryFs()` (`entry.ts:60`) — owner: agent — settled when #437 lands. Until
  then the read-only mode cannot ship: a wrapper over the sync mirror alone would leave the async
  `Vfs` (promise and stream writes) under `/node_modules` without `EROFS` — a silent lie; item 4's
  read-only half waits for #437 (or wraps the async surface too, with the same oracle).
- The read-only oracle (I3): Node v24.16.0 on a Linux read-only mount (a read-only tmpfs or bind
  mount in a CI container) for every mutating call's code/syscall/path — owner: agent — settled at
  item 4's PICKUP: the carrier records the table from live Node; without a runnable read-only mount
  in CI, the table is recorded once from a Linux machine with command, output and kernel version.
- Template mtimes: the artifact's tar records 0 for every entry (`dep-snapshot-tar.ts` `headerFor`);
  what `fs.statSync` of a template file reports vs `npm ci` (1985-10-26 from npm's tarballs) —
  owner: agent — probe against `npm ci`, then a compat row or the oracle's value.
- The four libraries in the guest (scenario steps 3, 9; I10) — owner: agent — main @ 57152054d
  (compat isolate-host row "Document libraries from `node_modules` in the state"): pdf-lib and docx
  write Node's documents; pptxgenjs `writeFile` since PR #435; exceljs's main entry and
  `xlsx.writeFile` since PR #440 (over #438/#439/#432). Every `require` I10 needs succeeds on main
  with the libraries in the state; the carrier re-proves it over the template. Outside I10: exceljs
  streaming writer/reader and `read`/`readFile` (zlib use: `epics/node-zlib-on-every-host`,
  ADR-0573; read streams: `distribution/isolate-host-fs-read-stream-needs-web-readablestream`, draft,
  PR #437 open).

## Out of scope

- Guest APIs the libraries need beyond I10: `epics/node-zlib-on-every-host` (zlib use), PRs #434 / #437 (open; fs stream `close`, read streams); Web API shims: ROADMAP M14 E.
- Building the artifact inside the guest (`npm` in the isolate); a template made by anything but
  `produceDependencySnapshot`.
- The agent tool set over the sandbox: `epics/isolate-host-agent-tools`.
- `exec`'s `signal`: landed, PR #431.
- npm publication: `epics/isolate-host-npm-delivery`.
- Templates shared across consumer processes or machines (one copy per process, one per worker).
- Persisting a template sandbox (`snapshot()` / `createSandbox({ snapshot })` over a template, a
  diff-only format, restore by template identity): `distribution/isolate-host-sandbox-template-snapshot`
  (user 2026-11-25).
- Lazy template reads (memory and latency independent of the template): deferred,
  `distribution/isolate-host-sandbox-template-lazy-read` (user 2026-11-25).
- The worker owning the run's whole FS; keeping a killed run's writes:
  `distribution/isolate-host-sandbox-killed-run-partial-writes` (user 2026-11-25).
