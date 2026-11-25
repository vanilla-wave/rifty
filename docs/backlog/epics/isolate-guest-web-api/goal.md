---
kind: epic
status: ready
title: Isolate guest Web API for document generators — Node 24's Blob/File, TextDecoder encodings and AbortController/AbortSignal/EventTarget/Event in the isolate guest
created: 2026-11-24
value: A document generator in `runCode` or a sandbox `exec` that hands back a `Blob`, decodes a legacy text encoding (fontkit) or uses `AbortController`/`AbortSignal`/`EventTarget`/`Event`/`CustomEvent` — directly or through Node's own stream code — gets what `node` gives over the same files, and these APIs' module exports (`buffer.Blob`/`buffer.File`, `util.TextDecoder`/`TextEncoder`) are the same objects, never `undefined`.
user_story: As a Node service running model-written document generators in an isolate-host sandbox, I want `pptx.write()` and `Packer.toBlob()` to give a `Blob`, pdfkit to load its built-in font and `new AbortController()` to work as in `node`, but today the first two stop at `isolate-host.Blob`/`blob is not supported by this platform`, fontkit at `isolate-host.TextDecoder(ascii) (only utf-8)`, and every `signal` option at `isolate-host.AbortController`
tier: works
---

## Outcome

Three groups of Node 24 Web API land in the isolate guest (`runCode` and sandbox `exec`,
ADR-0557/0568), each as Node v24.16.0's — proven against live Node, never approximated:

- `Blob`/`File`, with `buffer.Blob`/`buffer.File` as the same objects;
- `TextDecoder` for utf-8 and the 33 encodings where Node's decoders equal WHATWG Encoding (the
  five where Node's ICU decoders differ from WHATWG stay a named gap), `TextEncoder` utf-8 only as in Node;
- `AbortController`/`AbortSignal`/`EventTarget`/`Event`/`CustomEvent` as ordinary guest globals from
  Node's own sources, so Node's APIs taking a `signal` and Node's stream code (goal
  `node-streams-as-in-node`, which delivers this group as its unit 7) work in the isolate.

The module exports of these APIs are the same objects as the globals (`buffer.Blob`, `buffer.File`,
`util.TextDecoder`, `util.TextEncoder`); a member of them the guest still lacks
(`Blob.prototype.stream`, `TextDecoderStream`: web streams stay outside) is a named gap. The implementations run inside
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
   the isolate's zlib gap (`NotImplementedError('isolate-host.zlib.*')`) if this goal lands before
   the zlib goal's unit 3, never at `TextDecoder`; once both have landed it gives Node's output.

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

- I1. `Blob`/`File` behave as Node v24.16.0's in the guest: WPT `FileAPI/blob`/`FileAPI/file`
  (Node's vendored copy) through one shared WPT harness give every subtest the result live Node
  gives it, except `Blob-stream` (`stream()`, GC), `Blob-constructor`'s `MessageChannel` subtests
  and the `.html`/`.window.js`/`.worker.js` files (listed in the unit); plus the probe
  cases (values, thrown `name`/`code`/`message`, prototype chains, descriptors) — 0 differences.
  `Blob.prototype.stream` is the `ReadableStream` named gap.
- I2. `TextDecoder`/`TextEncoder` as Node's: for every WHATWG label of utf-8 and the 33 encodings
  where Node equals WHATWG (28 single-byte, `x-user-defined`, utf-16le/be, gbk, gb18030),
  `new TextDecoder(label)` gives Node's `encoding`, and decoding equals Node on the
  probe's corpus (every single byte and 2-byte sequence; gb18030 4-byte and euc-jp 3-byte forms
  sampled; random and `stream: true` splits; `fatal`, `ignoreBOM`); Node's errors for unknown labels and `replacement`
  (`RangeError [ERR_ENCODING_NOT_SUPPORTED]`) and for invalid data in `fatal` mode; a label of an
  encoding outside the set (big5, euc-jp, shift_jis, euc-kr, iso-2022-jp) throws its named gap at
  construction. WPT `encoding` through the shared harness
  equals live Node per subtest, except the unit's listed exclusions (`encoding/streams/*`,
  `idlharness.any.js`, the `MessageChannel` `encodeInto` subtest, the five's tests). utf-8 is not
  slower than today beyond noise. `TextEncoder` (utf-8 only) equals Node, `encodeInto`
  argument checks included.
- I3. `AbortController`, `AbortSignal` (with `abort`/`timeout`/`any`/`throwIfAborted`),
  `EventTarget`, `Event`, `CustomEvent` are the guest's globals from Node's sources and give Node's results on
  WPT `dom/abort`/`dom/events` through the shared harness, per subtest equal to live Node, except
  `timeout-shadowrealm.any.js` (ShadowRealm) and the `.html`/`.window.js`/`.worker.js` files
  (`reference/wpt`: none of the 13 `.any.js` files needs `MessageChannel`, GC or `fetch`;
  `Event-isTrusted` and `EventTarget-removeEventListener`, which Node fails, are compared — an equal
  failure is a valid comparison); `signal.reason` is an instance of the guest's
  global `DOMException` (today's class; its descriptor and `.code` equal Node's per
  `reference/today`; Node's code is bound to it); Node's APIs taking a `signal` (`events.once`/`on`, `timers/promises`, `fs.readFile`,
  `fs.promises.readFile`) equal Node in the guest. Carried by `node-streams-as-in-node` unit 7
  (`distribution/isolate-stream-core-abort-controller`) as its acceptance.
- I4. Same objects: `buffer.Blob`/`buffer.File` and `util.TextDecoder`/`util.TextEncoder` are `===`
  the guest's globals in a file run and in `runCode`; `({}) instanceof require('buffer').Blob` is
  `false`.
- I5. The user scenario (§User scenario) passes as executable cases against live `node`.

## Challenge

challenge: 2026-11-25 — reused for the ready goal: the promises are unchanged since the critic and
the final-check below except the manager's answers (T: the five a named gap; M1: `CustomEvent` in;
M2: web streams outside both goals; the events/abort unit in the streams goal), which close the
questions those passes raised. Final check of the ready result: line `final-check (ready)` below.

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
   globals (its former 7g); I3's rows join its acceptance (map «Delivered elsewhere»).
10. cheaper-route: the seam unit is only `buffer.ts:42-43` here — folded into the Blob unit (map 2); the
    captured-at-load item moved to `isolate-guest-modern-code`.
11. «every global before the runtime» forced a standalone event/abort copy — Decisions now load all
    three groups with the runtime (final-check: `blob.js` needs the runtime too), `buffer`'s
    exports bound at install.
12. cheaper-route: pdfkit duplicates the zlib carrier's case 4 — reused; its isolate stop is the
    zlib gap.
13.–15. stale lines in the blob/textdecoder drafts, the compat `url.toASCII` owner, modern-code's
    «rerun» — fixed.
- Omitted choice: question T gains option (c), WHATWG decoders declared ⚠️.

final-check: 2026-11-25 — fresh reviewer NOT PASS (1 blocker, 6 concerns, 6 nits), fixed: I3 excludes
`CustomEvent` tests while M1 is open; the duplicate globals unit removed (streams unit 7 already
carries them; re-pass: not seeded here until its home and M1 are settled); carrier text aligned
(order with zlib unit 3 stated) (two cases + zlib case 4, isolate zlib gap); I2 exclusions
(`encoding/streams`, idlharness streams); Blob's runtime dependencies → install with the runtime,
`buffer` exports bound then; `DOMException` identity in I3; captured-at-load's `crypto.subtle` row
owner; unit numbers; `owner:` values; «exhaustive» → sampled forms named; I1 exclusions match
the files; modern-code wording.

final-check (ready): 2026-11-25 — fresh reviewer over the ready goal, map and units 1–3 with the
new drafts: NOT PASS (1 blocker, 4 concerns, 6 nits), fixed: I3's carrier (unit 7 has no
acceptance and four globals today) — the hand-over recorded in Decisions and the closure condition
in map; captured-at-load's leak rows point to the silent-exports draft; unit 2's pins rewritten to the
probe's literal inputs; pin and guard counts; the `replacement` row; `DOMException` wording; «the
five» wording; unit 2 Acceptance 9 testable; unit 3 Acceptance 7 traces split (`compress: false` →
I2, case 4 → I5); docx devDependency to add. Raised for the report, not fixable here: T and M1 rest
on the manager's delegation; the streams goal's map still names exceljs as this goal's scenario 3 and
the isolate `ReadableStream` as this goal's.

review: 2026-11-25 — external review of PR #443 at 230c3272a (manager): no blockers, 5 should,
nits; verified `reference/today`, Node source hashes, labels and ICU numbers, gb18030's full 4-byte
space (1 587 600, 0 differences), bundle and warm cost, the user's quotes. Done: S1 whole-outcome
pins in the carrier; S2 lazy `single-byte.js` (unit 3 Acceptance 8–9); utf-8 throughput row and
the binding fix (Acceptance 11); S3 T's basis (Decisions, ICU draft, unit 3 Acceptance 13); S4 one
WPT harness owned by unit 2 (`reference/wpt`), live-Node comparison, I1–I3 exclusions; S5 the
probe counts an unfinished encoding as a difference (rerun: 0); N2 label counts; N3 base64url →
`node-streams-as-in-node` unit 2, own draft deleted; N4 `stream/consumers.blob` row,
`fs.openAsBlob` ⚠️ + `runtime-js/fs-open-as-blob-eager-read`; N6 not taken (manager); N7 fontkit's
labels + a TTF row; N8 unit 7 wording; N1 → `isolate-guest-modern-code` map.

challenge: 2026-11-24 — 12 problems (4 value/cheaper-route, 8 advisory) + 1 omitted user choice —
answered by the user's narrowing (value: the consumer's measured stops), the re-asked questions and
the split-out of `URL`/ESM.

## Decisions

- 2026-11-24 — user (manager thread `cf2ae711`, asked «Web API в isolate (`URL`, `Blob`, ESM) —
  открыть целью?»): «запускай».
- 2026-11-25 — user, question 1 (API set), in the manager thread cf2ae711. Asked first «а без них что не работает» and «я про поддержку офисных пакетов. Мы же не просто так начали эту цель»; the manager answered that of the four document libraries only the `Blob` outputs (`Packer.toBlob`, `pptx.write({outputType:'blob'})`) stop on a Web API, and recommended a narrowed goal. The user then answered «ок» to the manager's «Цель Web API — рекомендую сузить до Blob и кодировок TextDecoder, а URL и ES-модули вынести отдельной целью» and «ок» to «AbortController, EventTarget, Event в isolate — сделать обычными глобальными, как в Node».
- 2026-11-25 — manager, by the user's delegation of this work's design — the user's words when handing the work over (manager thread cf2ae711, 2026-11-24): «Я не ожидаю значимых развилок поэтому проектируешь ты сам»; features that come with a trade-off or keep finding corners are to be skipped and reported. Questions 2–4 were not taken up by the user; the manager's choices on them and on T, M1, M2 were reported to the user in the same thread on 2026-11-25 (reversible): the consumer's scenario closes the goal; cost is measured and recorded, no hard limit; tier works. Question 5 (ES modules in `-e`) left with ES modules.
- 2026-11-25 — manager, on the questions this narrowing raised: (T) the five encodings Node decodes through ICU (big5, euc-jp, shift_jis, euc-kr, iso-2022-jp) stay a named loud gap — Node's results there are ICU's, not WHATWG's, so neither a WHATWG decoder nor a guess is Node; no measured consumer; a draft carries them. (M1) `CustomEvent` becomes a global with the four — same Node file, no added bytes. (M2) web streams in the isolate stay outside both goals: `Blob.stream()` and `TextDecoderStream` are named gaps, a draft carries them. The events-and-abort unit lives in the streams goal (its first consumer is Node's `pipeline`); this goal's I3 rows are that unit's acceptance.
- 2026-11-25 — agent: all three groups' Node sources need the runtime (`blob.js` requires
  `internal/util/inspect`, `timers`, `task_queues`, `internal/encoding`, `internal/url`; the
  event/abort files `util.inspect`/`process.nextTick` and the stream core's `primordials`/`errors`),
  so they load with the runtime and become globals before guest code; the one load-time read of the
  set, `buffer.ts:42-43` (`Blob`/`File`, `reference/today/results-trace-load.txt`), is bound to the
  real classes at that install, not captured `undefined`. `blob.js`'s `internal/url` use
  (`URL.createObjectURL`/blob URLs) stays a named gap. Other ceilings stay as today.
- 2026-11-25 — agent, sources: `AbortController`/`AbortSignal`/`EventTarget`/`Event`/`CustomEvent`
  from Node's `internal/abort_controller.js` + `event_target.js` + `webidl.js` verbatim (`CustomEvent` included, manager
  decision M1)
  (`reference/sources-js`: 0/31 cases differ; ≈31 KB min / 9 KB gzip beside the streams core's
  shared `primordials`/`errors`, goal `node-streams-as-in-node` `route-b-size`; 88 KB / 30 KB gzip
  standalone); `TextDecoder` class from Node's `lib/internal/encoding.js`, single-byte and
  `x-user-defined` from Node's `encoding/single-byte.js` verbatim, utf-16/gbk/gb18030 decoders from
  @exodus/bytes 1.16.0 (equal to Node, which decodes them through ICU, on the corpus;
  `reference/textdecoder`; the whole composition in the guest bundle: +50.7 KB gzip, +0.5–0.6 ms warm with `single-byte.js` lazy (+3.3 eager),
  0 differences, `reference/textdecoder/bundle`); `Blob`/`File` from Node's `lib/internal/blob.js`/`file.js` over a JS byte
  store (`reference/sources-native`). Each source gets an ADR (semantic copy) before its unit.
- 2026-11-25 — manager: I3's rows and `CustomEvent` are handed to `node-streams-as-in-node` unit 7
  («Цели потоков это передам я»); that unit names `CustomEvent` and I3 as its acceptance
  (`docs/backlog/distribution/isolate-stream-core-abort-controller.md`, on main since PR #450); its
  I3 wording predates `reference/wpt` («without `MessageChannel`/GC») and follows this goal's I3;
  this goal's closure checks its contract.
- 2026-11-25 — manager (PR #443 review S3): T stands, its basis corrected — a consumer exists:
  pdfkit with a CJK TrueType font makes fontkit create `shift_jis`, `euc-kr`, `gbk` (and `big5`)
  decoders for the `name` table, and restructure's `readString` catches the gap's throw, so at the
  consumer the gap is silent: PDF bytes equal Node's, the font's family names differ (`BYTES n`);
  pinned in unit 3 (Acceptance 13), declared ⚠️.
- 2026-11-25 — manager (PR #443 review S4): one shared WPT harness, owned by the `Blob` unit,
  reused by the `TextDecoder` unit and `node-streams-as-in-node` unit 7; the guest is compared with
  live Node per subtest (`reference/wpt`: real `testharness.js` + a 26-line shim runs in the guest).
- 2026-11-25 — manager (PR #443 review S2, should): `single-byte.js` is required lazily (one
  declared anchored edit); utf-8 throughput is an acceptance row.
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
