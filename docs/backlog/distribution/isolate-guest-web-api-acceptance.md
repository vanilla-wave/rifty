---
area: distribution
status: ready
title: The isolate-guest-web-api scenario runs as committed-RED isolate-host cases against live `node` — pptxgenjs `write()` and docx `Packer.toBlob` as new cases, pdfkit as the zlib carrier's case 4
created: 2026-11-24
why: the goal's acceptance carrier; today the three generators stop at `blob is not supported by this platform`, `isolate-host.Blob` and `isolate-host.TextDecoder(ascii) (only utf-8)` where Node exits 0
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/goal.md, docs/backlog/epics/isolate-guest-web-api/reference/today/README.md, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-host/tests, packages/isolate-host/tests/closure-files.ts, packages/isolate-host/tests/zlib-scenario.test.ts]
---

## Context

Goal `isolate-guest-web-api` §User scenario as executable cases on the one host this goal
changes, the isolate (`createSandbox` + `exec`), oracle live `node` v24.16.0 over the same files in
a temp dir. Committed before any wall is fixed; each case pins today's whole outcome, so a change
for any reason is seen.

Today (`reference/today/results.txt`, main bc3412420 product code, Node v24.16.0):

| program | Node | isolate guest |
|---|---|---|
| `pptx-write.cjs` (`await pptx.write()` → `Blob` → `deck.pptx`) | exit 0, `[object Blob] Blob` / `bytes true` | exit 1, `Error: blob is not supported by this platform` (`jszip/lib/utils.js:378`: JSZip's `support.blob` probe failed at load) |
| `docx-toblob.cjs` (`Packer.toBlob(doc)` → `report.docx`) | exit 0, `[object Blob]` / `bytes true` | exit 1, `NotImplementedError: Not implemented: isolate-host.Blob (…)` (`docx/dist/index.cjs:23940`) |
| pdfkit 0.17.2, Helvetica | exit 0 | exit 1, `NotImplementedError: … isolate-host.TextDecoder(ascii) (only utf-8)` (`fontkit/dist/main.cjs:5424`) — `zlib-scenario.test.ts` case 4 pins it |

## Acceptance

1. `packages/isolate-host/tests/web-api-scenario.test.ts` runs `pptx-write.cjs` over pptxgenjs
   4.0.1's installed closure (`tests/closure-files.ts`): the sandbox's stdout, stderr, exit code and
   `deck.pptx` equal live `node pptx-write.cjs` over the same files — OOXML parts compared as the
   library probe does (XML text with `docProps/core.xml` timestamps masked, binary parts as bytes)
   → I5
2. The same for `docx-toblob.cjs` over docx 9.15.3 (added to isolate-host's devDependencies, exact pin) and `report.docx` → I5
3. pdfkit: `zlib-scenario.test.ts` case 4 is this goal's reuse, not a copy: its `GREEN` note names
   this goal for the `TextDecoder(ascii)` stop; once map unit 3 lands its isolate pin is the stop
   after fontkit's load (the zlib gap while the zlib goal's unit 3 is open), and with both landed
   case 4 equals Node → I5
4. RED, committed as plain `it` (not `it.fails`), the zlib carrier's way (`tests/zlib-scenario.ts`
   `Pin`/`pinOf`, PR #453): each case asserts its whole outcome as a literal pin — exit code,
   stdout, stderr, output file — `expect(pinOf(rifty)).toEqual(PIN)` and
   `expect(pinOf(rifty)).not.toEqual(pinOf(node))`; any other outcome, better or worse, fails → I5
5. A case leaves its pin in the PR of the unit that makes it pass (map units 2, 3): the pin is
   deleted and the case asserts equality with live Node, never an edited pin that still differs
   → I5

## Parity cases

- `pptx-write.cjs` (as `reference/today/run.mjs`): `p.addSlide().addText('Hi', {x:1,y:1})`,
  `const b = await p.write()`, print `Object.prototype.toString.call(b)` and `b.constructor.name`,
  `fs.writeFileSync('deck.pptx', Buffer.from(await b.arrayBuffer()))`, print
  `'bytes', buf.length > 1000` — RED → I5
- `docx-toblob.cjs`: one paragraph document, `const blob = await Packer.toBlob(doc)`, the same print
  and write — RED → I5
- zlib carrier case 4 (pdfkit) — RED, existing → I5

## Out of scope

- Browser hosts: their `Blob`/`TextDecoder` are native; this goal changes only the isolate.
- pdfkit's compressed output: the zlib goal's (`node-zlib-on-every-host`).

## Decisions

- 2026-11-25 — closures through the existing `tests/closure-files.ts` (owner: the library tests,
  ADR-0568), no new installer.
- 2026-11-25 — pdfkit stays one case, the zlib carrier's case 4 (goal Challenge 12).
- 2026-11-25 — manager (PR #443 review S1): whole-outcome literal pins with `pinOf`, plain `it`;
  `it.fails` on the first stderr line was the defect #453 found.
- 2026-11-25 — agent (PR #458): both cases pinned in the first commit; with unit 2 both equal
  live Node (pptx `write()` hit no further wall). The pins' stderr held rifty bundle frames, so
  the pins masked their line:column; with equality the mask went too.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
