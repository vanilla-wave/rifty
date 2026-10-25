# ADR0509: Judge decoded CSV export values in a corrected pilot

Status: Accepted
Date: 2026-10-05

## Context

ADR0506 own-origin checks, ADR0508 semantic UI discovery. Actual pilot-v2 COI
CSV1 correctly quotes every field;2 export checks demand unquoted email/name.
Public prompt requires proper CSV escaping, not serialization shape. RFC4180
§2.3/5/7: optional header/quoting, doubled internal quotes. Real native programme
and3 valid alternatives RED; malformed escaping/filter/duplicate controls FAIL.

## Decision

Decode exported CSV and compare exact records, accepting optional header/quotes
and LF/CRLF. Discover live field values, visible text or actual downloaded bytes;
no output caption/element/header spelling requirement. Hidden text cannot count.
No substring matching: extra/missing/wrong/duplicate records remain unsuccessful.
Primary format: [RFC4180](https://www.rfc-editor.org/rfc/rfc4180).

Freeze pilot-v3 with new CSV case path/ID, unchanged public task/project/controls;
notes-v2 and all library cases unchanged. Originalv1/v2 case files/scores remain
history with known oracle limitations. Shared support bytes change explicitly.
Fresh full72 after own-origin controls; no resume or historical re-scoring.

## Candidates/probe

- Canonical text/substrings: minimal old interface, rejected by actual quote-all
  exports and4 native valid-controlREDs; hides extra-record failures.
- Exact decoded tuples: kept; minimal boolean interface, no parser/platform
  dependency; native12 controls6PASS/6FAIL and10 guard-revertREDs.

Probe: `node --import tsx tools/agent-bench/tests/csv-export-controls.ts pilot-v2`
→ exit1/valid4FAIL/errors0; corrected default→native12 expected outcomes.
Node24.16.0, Chromium real installed Vite. Raw/external decode and command/log
proof: `docs/backlog/distribution/reference/agent-eval-csv-export-controls-data.json.gz`
and `agent-eval-csv-export-revert-proof.json.gz`.

## Header carrier

Independent actual Name,Email reference5/7FAIL exposed leftover lowercase
assumption (I6). Header fields use unambiguous English Name/Email purposes,
including descriptions/E-mail, independent of case/order. Email data cannot
be mistaken for a header; extra fields rejected before reordering. Field values
remain exact. Same public task/frozen candidatev3; no comparativev3 calls yet.
