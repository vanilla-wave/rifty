# Observed CSV export oracle repair

Baseline0bed68b575; real pilot-v2 CSV COI1 done104853ms/8tools,5PASS/2FAIL.
Both failures are representation assumptions: quote-all encoding of the correct
filtered rows. Public task says proper CSV escaping; RFC4180§2.3/5/7 allows
optional header/quoting. Native Python csv decodes both actual exports correctly.
Original49/72 retained;23missing, interrupted; no valid quality/I5 claim.

Fault: frozen-assumption+sibling-drift, owned functional-value projection.
Sweep: original CSVv1 and correctedv2 share substring checks; frozen historical
bytes preserved/known invalid for future quality. Currentv3 shares decoding and
visible output discovery; notes sibling has no CSV serialization projection.
Transport axes physically absent at this in-process projection; actual downloads
remain awaited/read, own-origin controls required. No runtime compatibility fix.

RED: actual programme + quote-all/quoted-header-pre/no-header controls allFAIL,
errors0. Functional escaping/filter/duplicate negativesFAIL. CLI parser2testsRED
before helper. GREEN: native12 controls6PASS/6FAIL,errors0; actual programme7/7.
Portable1/1PASS1.6min. Focused23testsPASS/typecheckPASS after process-env type fix.
All10 guard revertsRED; source restored: encoding, escaped quote, after-close,
bare quote, unfinished quote, exact records, header,CRLF,visible output,hidden text.

[Control programmes/results + external decode](agent-eval-csv-export-controls-data.json.gz)
and [guard mutations/logs](agent-eval-csv-export-revert-proof.json.gz).
[Original interrupted series](../../../../tools/agent-bench/reports/summaries/2026-10-05-pilot-csv-encoding-interrupted/README.md).
Actual programme fixture physical JSON SHA256
c6f41912a9f92ff66fa012d7c9fdc433f7ce0f57bf26df5b0e8f7803e31e7a0a.

ADR0509; v3 only new CSV case, same seed/prompt/controls; notes-v2/library cases
unchanged. Existing support hash includes helper bytes. No prior score rewrite,
native rescue or series resume. Own-origin16 controls/fullgate/finalreview pending.
Then fresh72 campaign; expansion/I10/I11 remain mandatory.

Preliminary own-origin16 allscoresPASS; script exit1 on wrong snapshot assertion
(full seed+patch compared to single-file patch). Corrected expected complete
seed+patch, preserves actual programme bytes; fresh full16 started separately.
[Original preliminary results/log](agent-eval-csv-origin-preliminary-snapshot-assertion.json.gz)
retained; no score rewrite or restart of that series.

Second fresh16 allscoresPASS; snapshot assertion then exposed declared-vs-actual
lock mismatch. Physicalbefore+patch equality independently checked for firstCOI:
no diff; seed lock72entries→actual22, esbuild0.28.2→0.28.0, addedwasm packages,
optionalplatform binaries omitted. Actualbeforehash already retained by runner;
not silently declared identical dependencies. [Second results/log](agent-eval-csv-origin-seed-snapshot-assertion.json.gz).
Final test now checks each physicalbefore+patch; fresh16 started. Host-substitution
semantics/version impact stays explicit I2/I10 evidence, not a CSV runtime repair.

ADR0023§Overrides re-applied and ADR0188 retain explicit baked overrides/
substitution provenance; physical esbuild version change is an ordinary host
policy difference, not claimed equivalent external dependency behavior. Common
declared seed/lock is still supplied; actual admitted tree/lock hashes retained.
I2/I10 comparison/cause reporting must expose this difference. Snapshot assertion
uses physical before+patch; no weakening to source-only equality.

Final fresh physical-before control script exit0,16/16PASS: references8,
actualprogramme4,quoted-header-pre4; full snapshots equal physicalbefore+patch.
Durable reports: `tools/agent-bench/reports/summaries/2026-10-05-csv-export-{reference,actual-programme1,quoted-header}-controls`.
No model calls; original49 unchanged. Fullgate/independentfinalreview pending.

Fullcurrent `pnpm pr:check`27/27PASS: test230.3s/parity117.5s,lint/typecheck/docs
gatesPASS. [Gate log](agent-eval-csv-export-pr-check.log.gz). Fix Final+GREEN
next; report/I5/expansion/I10/I11 stillopen.

Independent Final+GREEN4217af1e7 BLOCK: exact lowercase header remains hidden
requirement. Accepted; [original verdict](agent-eval-csv-export-fix-final-green-blocked.json),
[actual titlecase programme/unitRED](agent-eval-csv-semantic-header-red.json.gz).
Correction uses semanticName/Email purposes/case/descriptions/order, preserves
all fields and exact values; actual email data not a header, ambiguous purposes
not silently guessed. Native14 controls8PASS/6FAIL/errors0,portable1/1PASS1.8min;
unit5PASS; five added guard revertsRED/source restored.
[New native/unit/revert proof](agent-eval-csv-semantic-header-green.json.gz).
New own-origin8/fullgate/reviewerverification pending; v3 comparativecalls0.

Fresh header own-origin8/8PASS/script exit0, fullafter=physicalbefore+patch all4:
`2026-10-05-csv-titlecase-header-controls` and
`2026-10-05-csv-semantic-header-controls` under retained report summaries.
Native14/portable1/unit5/reverts5GREEN as above; fullcurrentgate next.

After accepted header blocker: fullcurrent `pnpm pr:check`27/27PASS,
test228.4s/parity117.8s; lint/typecheck/build/docsPASS.
[Current gate log](agent-eval-csv-semantic-header-pr-check.log.gz).
Independent verification next; v3 comparativecalls0, goal stillopen.
