Extend async controller with optimistic writes amid searches/navigation, failure rollback, retry and durable undo; stale responses cannot erase a later committed write.

Starting installed Vanilla JavaScript/Vite starter. Implement src/search-controller.mjs; preserve existing starter/build. Level 2; all level1 and level2 requirements below apply.

Published interfaces and observable requirements:


`src/search-controller.mjs`: `createController(client)`; client async
`search({filter,page,pageSize,sort})→{items,total}` and `update(id,patch)→row`.
Controller `search(query)`, `state()`, `select(id)`, `back()`, `exportJson()`,
`restoreJson(text)`; level2 `update`, `retry`, `undo` async. State exposes
`query,items,total,pending,selectedIds`; transient implementation layout free.
Filter case-sensitive substring, page1-based, sort `name-asc`/`value-desc`.
Later query wins over stale replies; selection persists across filters/pages;
back restores prior query; JSON restores query/selection. Level2 optimistic
patch visible before response, failed patch rolls back without losing query/
selection, retry commits, durable undo updates client, old query cannot erase
later committed write. Controlled external data/clock boundary allowed; actual
controller, timers and Node/runtime packages never mocked.

Actual three rows Alpha30/Beta20/Gamma10. Slow Alpha query then latest page2
value-desc ends at Beta20. Back/serialized navigation/selection verified.
Level2 optimistic Beta99→external failure→20→retry99→restored undo20;
stale Alpha response cannot erase later Beta77.


Provide tests for interactions/regressions. No subjective style score.
