Implement async indexed data/filter/sort/page/export engine behind supplied UI for 100000 deterministic records; preserve usable navigation while indexing.

Starting installed pinned Vanilla JavaScript/Vite7.3.6 starter; same dependency stack/engineering contract; resource scale alone changes. Only level1 behavior required; level2 addition not required.

Published requirement/API/user-action boundary:


Provided Load action, Search editor, Region/Month/Sort selects, Next page and
Export actions; named read-only Status/Matching rows/Page outputs. Level1
100000rows, level2 1000000; algorithm/data generator shared, scale alone changes.
Zero-based indexi: id=i+1,customer=`Customer ${i%4096}`,regions North/South/East/
West by i%4,cents=(i*7919)%1000000,month=i%12+1. Filter/search combined;
sort cents-desc with id-asc tie, page100, JSON export all filtered sorted rows.
During real indexing, visible navigation/search remains usable; actual input
event and visible Status are captured. Deadline begins before Load. If indexing
completed before interaction, control is functionally evaluated and explicitly
provides no during-indexing proof; do not slow an instant implementation.
Admission must obtain actual during-indexing evidence/meaningful pressure
before claiming responsiveness or closing the bounded question. Reference-grounded
final response deadline/finite upper-question rationale frozen before models;
no count-only closure. Independent scenario queries North/month1, exact
ceil(N/12) matching rows, page2, full unique/export identities/cents/order.
Resource bytes/rows/elapsed measured, unavailable memory explicit.

Preparation probes and source tests do not claim model success or boundary.
Different internals implementing these published interfaces remain valid.

Engine interface used by supplied src/main.js is public; implement it and preserve its observable workflows. Provide regression tests. Do not fake or replace the actual compiler.
