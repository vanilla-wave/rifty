# Independent oracle ruling — HOLDS

2026-10-05. Read-only; no browsers/models launched, no tracked files changed.
Scope: actual CSV pilot failures against public functional contract, not report review.

Authority: `docs/backlog/epics/agent-code-quality-evaluation/goal.md:87–90`
(I3: honest own-environment functional results; judging failures visible) and
`:103–109` (I6: working alternatives accepted; no unstated requirements/arbitrary
UI structure). `docs/process/rules/review.md` REV-2/REV-12: declared exactness only.

Public contract: `tools/agent-bench/corpus/cases/csv-workflow/prompt.md:1`:
“Provide accessible CSV data, Name/Email row fields, Filter and Export controls,
and named Import/Save actions; DOM/layout/architecture open.” No exact accessible
caption/label strings required. “Import CSV”, “Save changes”, “Export filtered CSV”
are named actions of the requested kind, not unmet functional requirements.

## Raw evidence

Root `/tmp/rifty-pr341-pilot-fresh-ofqf3ysq/series`;
`report.json` `.runs[task=csv-workflow,lane=rifty,runIndex=N]`;
per-run `csv-workflow/rifty/N/{after.json,browser.zip,screen.png}`.
Source revision in raw report: `03a531ab20f4f5d1a96f2b6baa93502ef53b75f3` (clean).

| Run | Executed failure / raw trace | Actual source, `after.json["src/main.tsx"]` |
| --- | --- | --- |
| 1 | `report.json`: fill `/CSV data/i` timeout; `browser.zip!trace.trace` call@1671, Frame.fill, 30000 ms | line 76: associated label “Paste CSV content”; line 77 “Import CSV”; line 79 “Save changes” |
| 2 | Four passing probes: quoted/invalid rows retained, invalid-save blocked, empty-name block after email repair, corrected contacts persist. Then `/^Export$/i` click timeout; call@2037 | line 88: button “Export filtered CSV”, handler `exportContacts` lines 71–74 uses `encodeCsv(filtered)`; associated output “Exported CSV” line 93 |
| 3 | `/^Import$/i` click timeout; call@2263 | line 78 “CSV data with name,email header”; line 79 button “Import CSV” (arrow aria-hidden); line 81 “Save changes”; line 83 “Filter contacts by name or email” / “Export filtered” |

Viewed run2 `screen.png`: actual Rifty preview displays matching Export button and
Filter CORRECTED after saved contacts restore. Trace selectors/errors independently
agree with report. Run2's barrier is label exactness; remaining export/re-import
requirements were never reached. These observations do NOT prove any entire
agent program correct; build success does not close functional acceptance. Run1
also has a filter label with no textual content: accessibility needs real browser
verification before considering that whole program a positive control.

After-file SHA256s: run1 `af76e9f9e2d23df1e512802328befea8d15c8240e032026d7991d44a60287490`;
run2 `757d2ea35be9f5995d1297c16a029562817330530ba5d4efba1832579b31e7b9`;
run3 `35d94f2d7eb1e42ed2c387e9fc375a35b09e2bb6391ea29347adef7859cb84dd`.

## Fault-class sweep

- CSV judge `:8,12,24,52,55,90`: literal CSV-data phrase, exact Import/Save/Filter/Export.
  `:56` additionally assumes output accessible name contains Export, although prompt
  permits any accessible CSV output/download; “Filtered CSV output” deserves a control.
  Name/Email `\b` patterns already allow row descriptions.
- Markdown-notes public `prompt.md:1` likewise opens implementation/DOM/layout.
  Judge `:11–12,16,43,46,52,58,61,69,78,81` requires exact generic
  Title/Markdown/Save/Search/Delete. “Note title”, “Markdown content”, “Search notes”,
  “Save note”, “Delete note” retain those public semantics. Same lexical fault class.
  `entry` `:6–9` requires title-only button/link names; cover “Open Alpha” too.
  Exact expected heading text, entered body/title values and [[Beta]] target remain
  functional assertions, not a reason to loosen data comparisons.
- All five legacy task judges inspected with their public prompts. Existing baseline
  Dashboard/Issues route labels and issue-card structure have baseline authority;
  new-issue uses loose action/title patterns. No same generic-label defect identified
  there within this sweep. Node endpoint judge has no UI labels.
- `tests/app-structure-controls.ts:29–61` changes element/layout/rendering roles but
  retains exact generic control names; existing alternatives likewise retain them.
  Those controls cannot discriminate this caption fault.

## Smallest honest RED and repair

1. Retain exact run2 full `after.json` tree as an actual-program fixture. Existing
   executed trace already establishes RED at Export. Replay full old/new workflow
   in actual originating Rifty preview; new judge must reach export and draft/reload
   assertions. Report resulting app defects independently; never award a pass on build.
2. Add label-only working control from current exercised reference: vary CSV source,
   Import/Save/Filter/Export captions and accessible output (“Paste CSV content”,
   “Import CSV”, “Save changes”, “Filter contacts”, “Export filtered CSV”,
   “Filtered CSV output”); notes: “Note title”, “Markdown content”, “Search notes”,
   “Save note”, “Delete note”, “Open Alpha”. Execute old judge RED, repaired judge GREEN.
   Baseline/partial/search-only/broken escaping/persistence controls must still fail
   for functional reasons. Keep actual workflow, real VFS/preview, no mocked sibling.
3. Fix only trusted semantic discovery: accessible role/name matching with word/token
   boundaries (CSV editable source distinct from readonly CSV output), descriptions
   allowed; keep data/workflow assertions unchanged. No arbitrary first textbox or
   global button clicks, implementation IDs, text-content-only inaccessible controls,
   source-code scoring, or agent-specific special casing. Preserve link/button and
   input/searchbox/textarea alternatives and download receipt checking.
4. Freeze a corrected **new pilot version** before a fresh campaign, retaining families,
   projects, public functional requirements and old selected rows. Current loader
   `src/corpus.ts:72` shares case directories; version-isolated paths/loading required
   to keep pilot-v1 case bytes/checksums reusable. Do not edit frozen v1 cases, historical
   results, hashes or old outcomes in place; separate correction/rejudge evidence from
   the original series. Preserve private judges/controls (corpus.ts:78–79) and
   own-origin grading (`src/runner.ts:220–221`), never exported-native rescue.

Verdict: HOLDS oracle defect. Claim “all CSV agents produced working applications”
is unproven; blanket upgrade of old failures to success would violate I3. Repair
and RED/GREEN execution remain unperformed in this read-only verification.
