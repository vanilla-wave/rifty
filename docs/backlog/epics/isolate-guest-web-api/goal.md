---
kind: epic
status: draft
title: Isolate guest Web API for document generators — Node 24's Blob/File, TextDecoder encodings and AbortController/AbortSignal/EventTarget/Event in the isolate guest
created: 2026-11-24
value: A document generator in `runCode` or a sandbox `exec` that hands back a `Blob`, decodes a legacy text encoding (fontkit) or uses `AbortController`/`AbortSignal`/`EventTarget`/`Event` — directly or through Node's own stream code — gets what `node` gives over the same files, and these APIs' module exports (`buffer.Blob`/`buffer.File`, `util.TextDecoder`/`TextEncoder`) are the same objects, never `undefined`.
user_story: As a Node service running model-written document generators in an isolate-host sandbox, I want `pptx.write()` and `Packer.toBlob()` to give a `Blob`, pdfkit to load its built-in font and `new AbortController()` to work as in `node`, but today the first two stop at `isolate-host.Blob`/`blob is not supported by this platform`, fontkit at `isolate-host.TextDecoder(ascii) (only utf-8)`, and every `signal` option at `isolate-host.AbortController`
tier: works
---

## Outcome

Three groups of Node 24 Web API land in the isolate guest (`runCode` and sandbox `exec`,
ADR-0557/0568), each as Node v24.16.0's — proven against live Node, never approximated:

- `Blob`/`File`, with `buffer.Blob`/`buffer.File` as the same objects;
- `TextDecoder` with the encodings Node 24 decodes (WHATWG Encoding labels → Node's decoders),
  `TextEncoder` utf-8 only as in Node;
- `AbortController`/`AbortSignal`/`EventTarget`/`Event` as ordinary guest globals from Node's own
  sources, so Node's APIs taking a `signal` and Node's stream code (goal `node-streams-as-in-node`)
  work in the isolate.

The module exports of these APIs are the same objects as the globals (`buffer.Blob`, `buffer.File`,
`util.TextDecoder`, `util.TextEncoder`); a member of them the guest still lacks
(`Blob.prototype.stream`: web streams stay outside) is a named gap. The implementations run inside
the guest isolate under their limits; their cost is measured and recorded. `URL`/`URLSearchParams`
and ES modules are goal `isolate-guest-modern-code`; other Web API ceilings are unchanged.

## User scenario

The consumer's document generators in an isolate-host sandbox whose `node_modules` holds
pptxgenjs 4.0.1, docx 9.15.3 and pdfkit 0.17.2; each runs as `sandbox.exec(<file>)` and as
`node <file>` over the same files:

1. `pptx.cjs`: `const blob = await pptx.write()` (no `outputType`: a `Blob`);
   `fs.writeFileSync('deck.pptx', Buffer.from(await blob.arrayBuffer()))`.
2. `docx.cjs`: `Packer.toBlob(doc)` → `report.docx` the same way.
3. `pdf.cjs`: pdfkit with its built-in font (`Helvetica`), `compress: true` → `out.pdf` — the zlib
   goal's case 4 (`packages/isolate-host/tests/zlib-scenario.test.ts`), reused, not duplicated.
4. Runs 1–2 give the stdout, stderr, exit code and files `node` gives (OOXML timestamps masked as
   the library probe does). Run 3 gets past fontkit's load: while the zlib goal is open it stops at
   the isolate's zlib gap (`NotImplementedError('isolate-host.zlib.*')`), never at `TextDecoder`;
   once zlib lands it gives Node's output.

## Invariants

<!-- False on main bc3412420 (`reference/today/`, Node v24.16.0): `new Blob`/`new File` →
`NotImplementedError('isolate-host.Blob'|'File')`, `require('buffer').Blob` `undefined`,
`({}) instanceof require('buffer').Blob` → `TypeError: Right-hand side of 'instanceof' is not an
object`; the guest `TextDecoder` accepts 3 of the 222 labels Node accepts and
`new TextDecoder('nope')` throws `NotImplementedError` (Node `RangeError
[ERR_ENCODING_NOT_SUPPORTED]`); `new AbortController()`/`new EventTarget()`/`new Event('x')` →
named gaps, `AbortSignal.timeout` → `TypeError: … is not a function`, `events.once(…, {signal})`,
`timers/promises.setTimeout(…, {signal})`, `fs.readFile(…, {signal})` → `isolate-host.AbortController`;
scenario: `pptx.write()` → `blob is not supported by this platform`, `Packer.toBlob` →
`isolate-host.Blob`, pdfkit → `isolate-host.TextDecoder(ascii) (only utf-8)`. -->

- I1. `Blob`/`File` behave as Node v24.16.0's in the guest: Node's own WPT runs
  `test/wpt/test-blob.js`/`test-file.js` (WPT `FileAPI` as Node vendors it) give the guest the
  results Node's `test/wpt/status/FileAPI/` records for Node, except `Blob-stream` (`stream()`, GC)
  and `Blob-constructor`'s `MessageChannel` cases (listed in the unit); plus the probe
  cases (values, thrown `name`/`code`/`message`, prototype chains, descriptors) — 0 differences.
  `Blob.prototype.stream` is the `ReadableStream` named gap.
- I2. `TextDecoder`/`TextEncoder` as Node's: for every WHATWG label of an encoding in the set (map
  question T), `new TextDecoder(label)` gives Node's `encoding`, and decoding equals Node on the
  probe's corpus (every single byte and 2-byte sequence; gb18030 4-byte and euc-jp 3-byte forms
  sampled; random and `stream: true` splits; `fatal`, `ignoreBOM`); Node's errors for unknown labels and `replacement`
  (`RangeError [ERR_ENCODING_NOT_SUPPORTED]`) and for invalid data in `fatal` mode; a label of an
  encoding outside the set throws its named gap at construction. Node's WPT `test/wpt/test-encoding.js`
  results for the set as Node's status records, except `encoding/streams/*` and the streams part of
  `idlharness.any.js` (`TextDecoderStream`: map question M2). `TextEncoder` (utf-8 only) equals Node, `encodeInto`
  argument checks included.
- I3. `AbortController`, `AbortSignal` (with `abort`/`timeout`/`any`/`throwIfAborted`),
  `EventTarget`, `Event` are the guest's globals from Node's sources and give Node's results on
  Node's WPT runs `test/wpt/test-abort.js`/`test-events.js` (`dom/abort`, `dom/events`) as Node's
  status records, except tests needing `MessageChannel` or GC, and those constructing `CustomEvent`
  while map question M1 is open (listed in the unit); `signal.reason` is an instance of the guest's
  global `DOMException` (today's class, equal to Node's per `reference/today`; Node's code is bound to
  it); Node's APIs taking a `signal` (`events.once`/`on`, `timers/promises`, `fs.readFile`,
  `fs.promises.readFile`) equal Node in the guest.
- I4. Same objects: `buffer.Blob`/`buffer.File` and `util.TextDecoder`/`util.TextEncoder` are `===`
  the guest's globals in a file run and in `runCode`; `({}) instanceof require('buffer').Blob` is
  `false`.
- I5. The user scenario (§User scenario) passes as executable cases against live `node`.

## Challenge

challenge: 2026-11-25 — 15 problems (1 blocker, 2 cheaper-route, 9 concerns, 3 nits) + 3 omitted
choices — fresh read-only critic over the manager's instruction, the narrowed goal/map/drafts, the
split-out epic and the probes. Verified; dispositions:

1. blocker: gap honesty for every Web API outside the guest widened the narrowed set — Outcome,
   `value`, I4 narrowed to the set's own exports.
2. `CustomEvent` added beyond the four named — out of the invariants; manager question M1.
3. I2's label clause vs the named gap — I2 now says where the gap fires (construction).
4. the TextDecoder unit seeded on open question T — split: class + the 33 Node=WHATWG encodings
   seeded (map unit 3), the five ICU-only after T.
5. I1 «every call of `test-blob*`/`test-file*`» pulled in `stream()`, `structuredClone`, `URL`, fs
   tests — I1 uses Node's WPT runners and status files with a listed exclusion set.
6. I3 globs matched the wrong files — I3 uses `test/wpt/test-abort.js`/`test-events.js` + status.
7. `TextEncoder` without an invariant — in I2.
8. web streams have no owner after the split (the streams goal points here) — manager question M2.
9. the I3 rows had no carrier if unit 7 lives in the streams goal — unit 7 already carries the
   globals (its former 7g); I3's rows join its acceptance (map unit 4).
10. cheaper-route: the seam unit is only `buffer.ts:42-43` here — folded into the Blob unit (map 2); the
    captured-at-load item moved to `isolate-guest-modern-code`.
11. «every global before the runtime» forced a standalone event/abort copy — Decisions scope it to
    `Blob`/`File`.
12. cheaper-route: pdfkit duplicates the zlib carrier's case 4 — reused; its isolate stop is the
    zlib gap.
13.–15. stale lines in the blob/textdecoder drafts, the compat `url.toASCII` owner, modern-code's
    «rerun» — fixed.
- Omitted choice: question T gains option (c), WHATWG decoders declared ⚠️.

final-check: 2026-11-25 — fresh reviewer NOT PASS (1 blocker, 6 concerns, 6 nits), fixed: I3 excludes
`CustomEvent` tests while M1 is open; the duplicate globals unit removed (streams unit 7 already
carries them); carrier text aligned (two cases + zlib case 4, isolate zlib gap); I2 exclusions
(`encoding/streams`, idlharness streams); Blob's runtime dependencies → install with the runtime,
`buffer` exports bound then; `DOMException` identity in I3; captured-at-load's `crypto.subtle` row
owner; unit numbers; `owner:` values; «exhaustive» → sampled forms named; I1 exclusions match
the files; modern-code wording.

challenge: 2026-11-24 — 12 problems (4 value/cheaper-route, 8 advisory) + 1 omitted user choice —
answered by the user's narrowing (value: the consumer's measured stops), the re-asked questions and
the split-out of `URL`/ESM.

## Decisions

- 2026-11-24 — user (manager thread `cf2ae711`, asked «Web API в isolate (`URL`, `Blob`, ESM) —
  открыть целью?»): «запускай».
- 2026-11-25 — user, question 1 (API set): answered — recorded by the manager.
- 2026-11-25 — manager, reversible (questions 2–4 not taken up by the user): the scenario is the
  consumer's generators; cost is measured and recorded, no hard bound; tier `works`. Question 5
  (ESM in `-e`) dropped with ESM.
- 2026-11-25 — agent: all three groups' Node sources need the runtime (`blob.js` requires
  `internal/util/inspect`, `timers`, `task_queues`, `internal/encoding`, `internal/url`; the
  event/abort files `util.inspect`/`process.nextTick` and the stream core's `primordials`/`errors`),
  so they load with the runtime and become globals before guest code; the one load-time read of the
  set, `buffer.ts:42-43` (`Blob`/`File`, `reference/today/results-trace-load.txt`), is bound to the
  real classes at that install, not captured `undefined`. `blob.js`'s `internal/url` use
  (`URL.createObjectURL`/blob URLs) stays a named gap. Other ceilings stay as today.
- 2026-11-25 — agent, sources: `AbortController`/`AbortSignal`/`EventTarget`/`Event`/`CustomEvent`
  from Node's `internal/abort_controller.js` + `event_target.js` + `webidl.js` verbatim (`CustomEvent`,
  in the same `event_target.js`, is the manager's question M1)
  (`reference/sources-js`: 0/31 cases differ; ≈31 KB min / 9 KB gzip beside the streams core's
  shared `primordials`/`errors`, goal `node-streams-as-in-node` `route-b-size`; 88 KB / 30 KB gzip
  standalone); `TextDecoder` class from Node's `lib/internal/encoding.js`, single-byte and
  `x-user-defined` from Node's `encoding/single-byte.js` verbatim, utf-16/gbk/gb18030 decoders from
  @exodus/bytes 1.16.0 (equal to Node, which decodes them through ICU, on the exhaustive corpus;
  `reference/textdecoder`); `Blob`/`File` from Node's `lib/internal/blob.js`/`file.js` over a JS byte
  store (`reference/sources-native`). Each source gets an ADR (semantic copy) before its unit.
- rejected route: npm polyfills (`event-target-shim` 6.0.2 + `abortcontroller-polyfill` 1.7.8:
  22/31 differ; `formdata-node` Blob 9/19, `blob-polyfill` 13/19; `text-encoding` 0.7.0 differs on
  `iso-8859-8-i` and gbk/gb18030; iconv-lite has no `fatal`) — violates I1–I3.
- rejected route: a bridge to the host Node — outside the isolate's memory limit, a new host
  function over hostile input amends ADR-0557 §6 — violates Outcome «inside the guest isolate under
  its limits».
- rejected route: a use-time forwarder over `globalThis[name]` (PR #440 round 2) — `new.target`
  prototype defect, internals depend on what the guest puts in `globalThis` — violates I4.
- rejected route: lazy install of a global on first access — Node's are data properties
  (`reference/today`: all ten `w1e0c1`), an accessor is observable — violates I1–I3. (A decoder's
  table built on first `new TextDecoder(label)` is not this: the global is a plain data property.)
