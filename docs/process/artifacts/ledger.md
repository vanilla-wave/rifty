# Ledger — useful decisions and history

`docs/backlog/epics/<slug>/ledger.md`; append dated one-liners with evidence
links. Record a fact once. History is not a queue of obligations: CLOSE checks
the accepted result, required residuals and external promises, not every line.

A slice navigation record:
`- <date> — re-chart after <slice> (final-green PASS @ <sha>): <what changed>`.
The verdict JSON owns the review result; this line points to it for the next
slice's BASE. Legacy `ordinary PASS` lines mean the same previously reviewed
slice; no new ordinary review mode exists.

User amendments live in `goal.md` (`RDY-6`); link them here when they change the
route. Diagnoses and failed attempts can remain history; export only durable
knowledge and evidence needed by the delivered result (`stages/close.md`).
