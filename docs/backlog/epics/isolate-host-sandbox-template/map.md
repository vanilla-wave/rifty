# Map — isolate-host-sandbox-template

Design: ADR-0572 (Proposed). Probes: `docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/`.

## Items

Seeded after FIT (the `owner: user` questions below shape every child). Planned order, each a
hypothesis until the carrier hits it:

1. Acceptance carrier — the User scenario as an e2e over a real `produceDependencySnapshot`
   artifact of the four libraries, committed RED (`it.fails`).
2. Binary request frame (`distribution/isolate-host-binary-request-frame`, absorbed): the template
   goes to a worker once, as bytes; base64 inside a JSON line is +33 % and a 127 MB string.
3. Template intake in the consumer: artifact → decoded template (gzip/br, ustar + PAX), named
   refusals, identity, one copy per process.
4. Snapshot format v2 (ADR-0567 §3/§4): a layer over a bound template; v1 still read.
5. The run's FS over the template (ADR-0572 §2), the end state taken outside the guest's realm
   (absorbs `distribution/isolate-host-sandbox-capture-outside-guest-realm`), the changed-paths list.
6. Host ops and the cap over the difference only (absorbs
   `distribution/isolate-host-sandbox-write-cost-per-state`).
7. Worker template cache: by identity, in the RSS ceiling, evicted with the worker.
8. README cost table (~1 MB vs ~95 MB template), compat rows, compressed-budget note.

## Open questions

- Mechanism: the guest's FS during a run (ADR-0572 §Alternatives: materialize / lazy template /
  worker-owned FS) — owner: user — it changes the recorded decisions «rifty целиком внутри
  isolate…», «Владелец ФС живёт в том же realm…» (ADR-0572 §Trust).
- Template files: writable (copy-on-write, deletions in the format) or read-only (`EROFS`) — owner:
  user — requirements §2 acceptance names deletions/changes, §Открытые вопросы leaves it open.
- Mount point: `/node_modules` or `/workspace/node_modules`; the artifact's `payload/package.json`
  and lock visible or not — owner: user — both resolve as Node (probe M); what the agent sees in its
  cwd differs.
- A killed run's writes (`timeout`, `memory`, abort): kept as Node or rolled back — owner: user —
  answered once for this goal, the agent tools' texts and `exec`'s `signal`.
- Guest-side cache of template stats/bytes during a run (pdf-lib's `require`: ~6 200 stats, 915
  reads → +100 ms in probe L without one; `fs.readSync` reads the whole file per call) — owner:
  agent — settled by the carrier's timing against the cost invariant.
- Template mtimes: the artifact's tar records 0 for every entry (`dep-snapshot-tar.ts` `headerFor`);
  what `fs.statSync` of a template file reports vs `npm ci` (1985-10-26 from npm's tarballs) —
  owner: agent — probe against `npm ci`, then a compat row or the oracle's value.
- The four libraries' `require` needs Web APIs the guest lacks → the library-probe thread's report
  (ROADMAP M14 E) — owner: agent — scenario step 3/10 depends on it; a gap there is a dependency,
  not this goal's scope.

## Out of scope

- Web API shims the libraries may need (`URL`, `Blob`, web streams, `zlib`): ROADMAP M14 E.
- Building the artifact inside the guest (`npm` in the isolate); a template made by anything but
  `produceDependencySnapshot`.
- The agent tool set over the sandbox: `epics/isolate-host-agent-tools`.
- `exec`'s `signal`: `distribution/isolate-host-sandbox-exec-abort-signal`.
- npm publication: `epics/isolate-host-npm-delivery`.
- Templates shared across consumer processes or machines (one copy per process, one per worker).
