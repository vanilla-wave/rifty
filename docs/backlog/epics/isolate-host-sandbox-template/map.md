# Map — isolate-host-sandbox-template

Design: ADR-0572 (Proposed). Probes: `docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/`.

## Items

Children are seeded when the carrier runs (README §FIT 5); planned order, each a hypothesis until
the carrier hits it:

1. Acceptance carrier — the User scenario as an e2e over a real `produceDependencySnapshot`
   artifact of the four libraries (published `@riftydev/workbench`, as the library probe), committed
   RED (`it.fails`), I1–I11; I11's generator and named rows seeded from probes G (`gen.mjs`) and S
   (`seq.mjs`).
2. `LayeredFsSync` in `@riftydev/vfs` (ADR-0572 §2): the layered class, its node-identity state
   (untouched = one `lazy` / `ref` row, anything else explicit) and its rebuild, the cap counted
   over the state, writable and read-only modes; I11's generator in CI (fixed seed range; class,
   run boundary, cap count and reads-only minimality per sequence; a failure prints seed +
   minimized sequence) and its named rows, as an `FsSync` and through runtime-js `fs` (I3, I4 shared bytes,
   I6, I11).
3. Template intake and host ops in the consumer, with every loud gap of the not-yet-run template in
   the same unit — `snapshot()` / `createSandbox({ snapshot })` over a template (I8) and `exec` over
   a template (`NotImplementedError('isolate-host.sandbox-template-exec')`, lifted by item 5), so no
   state between items runs silently without its template: artifact → decoded template (gzip/br,
   ustar + PAX), named refusals, identity and packages, a process registry by id, one shared buffer
   and index per process; host ops on item 2's class, the cap counted over the state (absorbs
   `distribution/isolate-host-sandbox-write-cost-per-state`) (I1, I3 host side, I4, I5 host rows,
   I8).
4. Worker template cache + binary request frame (absorbs
   `distribution/isolate-host-binary-request-frame`): a worker receives a template once, as bytes
   (base64 inside a JSON line is +33 % and a ~90 MB string), keeps it by identity in its RSS ceiling
   and idle watermark, evicted with the worker (I4, I5 frame rows).
5. The run over the template (ADR-0572 §3), lifting item 3's `exec` refusal: index built in the
   isolate, item 2's class as the realm's only FS surface, the sandbox's state rebuilt before and
   handed back after the run, validated by the consumer (ADR-0572 §5); the changed-paths list; the F1 return condition measured
   here (goal Decisions) (I2, I3, I6, I11).
6. The end state taken where the guest's code cannot reach (absorbs
   `distribution/isolate-host-sandbox-capture-outside-guest-realm`; mechanism at its PICKUP,
   ADR-0572 §9) (I7).
7. README cost table (T1, T95, the four-library artifact), the isolate rule's two cases, compat
   rows (template snapshot ❌); the F1 return condition re-measured on landed code (I5, I10).

## Open questions

- The process registry's lifetime: unregistering or evicting a template (a long-lived consumer
  that rebuilds its template keeps every old version, ~90 MB each) — owner: agent — settled at item
  3's PICKUP (an explicit release or one held while a sandbox references it), I4 documented.
- Overlap with PR #437 (open, the user's track: every guest's FS sync-only; `entry.ts:60` still
  calls `installMemoryFs()` on main) — owner: agent — a template run installs item 2's class as
  the realm's only FS surface itself (ADR-0572 §3), so neither the read-only mode nor streams wait
  for #437; whichever lands second rebases onto the other.
- Per-call overhead of the layered class in a run (probe F, four-library artifact, run phase vs
  the same files in the state, load ~5: +18…+25 ms per generator, four at once +7…+41) — owner:
  agent — item 5 re-measures it on landed code against the F1 return condition; above the
  tolerance the run stops and the numbers go to the user.
- The read-only oracle (I3): Node v24.16.0 on a Linux read-only mount (a read-only tmpfs or bind
  mount in a CI container) for every mutating call's code/syscall/path — owner: agent — settled at
  item 2's PICKUP: the carrier records the table from live Node; without a runnable read-only mount
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
