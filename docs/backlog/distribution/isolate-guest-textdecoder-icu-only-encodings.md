---
area: distribution
status: draft
title: In the isolate guest `TextDecoder` for big5, euc-jp, shift_jis, euc-kr and iso-2022-jp stays a named gap — Node's ICU decoders differ from WHATWG there
created: 2026-11-25
why: Node v24.16.0 decodes these five through ICU `ucnv`, whose results differ from the WHATWG Encoding Standard, so no WHATWG decoder is Node's there; their one measured consumer (fontkit) swallows the gap silently
sources: [docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/README.md, docs/backlog/epics/isolate-guest-web-api/goal.md]
code: [packages/isolate-guest/src/guest/text-codec.ts]
---

## Context

Manager decision 2026-11-25 (goal `isolate-guest-web-api` Decisions, question T, reversible): the
five stay `NotImplementedError('isolate-host.TextDecoder(<enc>)')` at construction while the
goal's `TextDecoder` unit makes utf-8 and the 33 Node=WHATWG encodings real. Compat ❌ row in that
unit.

Probe `reference/textdecoder` (Node v24.16.0, WHATWG `encoding` @ 7d2e3e08e1; every 2-byte
sequence + random/stream splits), differing sequences Node vs WHATWG: big5 8 401 / 69 792,
euc-jp 16 681 / 78 628, shift_jis 3 121 / 69 792, euc-kr 19 530 / 69 792, iso-2022-jp 26 / 69 792.
Shapes: an invalid lead byte is dropped silently (`80`/`81` in euc-kr, euc-jp, big5 → `''`, no
throw even with `fatal`); euc-kr `81 41` → `'A'` (plain KS X 1001, no windows-949 extension); big5
`88 62` → `''`; shift_jis swaps control bytes (`1a` → U+001C, `7f` → U+001A, `1c` dropped).

Consumer (PR #443 review S3; probe `reference/textdecoder/bundle/fonts.mjs`, `results-fonts.txt`):
pdfkit 0.17.2 with a CJK TrueType font makes fontkit 2.0.4 create `shift-jis`, `big5`, `euc-kr`
(and `gbk`, in the set) decoders for Mac `name` records (the review saw Hiragino → shift_jis ×13,
AppleGothic → euc-kr ×6, Songti → gbk ×6); restructure's `readString` catches the throw, so the
gap is **silent** at the consumer: PDF bytes equal Node's, the family names differ — Node
`{ja: 'テスト', ko: '가나', zh: '测试', 'zh-Hant': '測試'}`, the guest `{ja: 'BYTES 6', ko: 'BYTES 4',
zh: '测试', 'zh-Hant': 'BYTES 4'}` (probe font: DejaVu Sans 2.37.3 with Mac records added; Apple's
fonts are not redistributable). Pinned in `distribution/isolate-guest-textdecoder-legacy-encodings`
Acceptance 13, compat ⚠️.

Exit routes, none measured: a port of ICU's converters for the five — a Node-output dump of every
2-byte sequence is 36–55 KB gzip per encoding (`results-icu-dump-size.txt`; big5 52, euc-jp 49,
shift_jis 55, euc-kr 36; iso-2022-jp stateful, not measured), plus ICU's converter state machine
(lead-byte drops, `fatal` without a throw); or WHATWG decoders declared ⚠️ (browser results, not
Node's). Trigger: a guest program needing CJK font names, or a package decoding one of the five loudly.

## Challenge

challenge: 2026-11-25 — not run (factual capture of a manager decision)
