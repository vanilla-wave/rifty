# Boundary public interfaces and scenarios — preparation

These interfaces must appear in public task prompts/cards before admission.
They specify the tested program boundary, not an undisclosed implementation.
Engineering tasks implement module APIs; compiler/resource implement engines
behind the supplied browser UI. Preserve provided UI/client regressions.

## Linked import

`src/workbook.mjs`: `createWorkbook()` returns `importFiles({customers,invoices,
credits?})`, `snapshot()`, `exportJson()`, `restoreJson(text)`, `undo()` at level2.
Customers CSV `id,name`; invoice CSV `id,customer_id,amount,currency`; credits
level2 CSV `id,invoice_id,amount`. LF/CRLF, quoted comma/quote/newline and blank
lines supported. IDs nonempty/unique/case-sensitive; references checked before
commit; amount nonnegative decimal with at most2 fractional digits, no rounding.
Currency uppercase3-letter key, no conversion. Syntax error reports 1-based
line/column of opening unterminated quote; failed import preserves prior state.
Snapshot customers `{id,name}`, invoices `{id,customerId,cents,currency}`;
level2 credits `{id,invoiceId,cents}`, totals per currency after credits.
Integer cents exact; aggregate credits may not exceed invoice amount. JSON
roundtrip restores current state; level2 also preserves undo history across
restore. Serialized internal layout free. A snapshot observation captured before
failure is cloned by the independent probe; mutable aliases cannot hide drift.

Actual scenarios: quoted names, multiline names, missing customer, duplicate
key,3fractional digits, malformed quote; rejected cases preserve captured state.
Level2 two credits1+2 cents against10001 cents →9998 USD; over-credit rejected;
restored undo returns10001 USD, independent EUR200 cents preserved.

## Async state

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

## Compiler browser

Provided accessible controls: Source editor, Target select `es2015/es2020`,
Compile action, named read-only JavaScript/Diagnostics outputs. Level2 Compiler
select `typescript/esbuild`; real esbuild-wasm0.28.0 asset/API required.
TypeScript5.9.2 transpileModule promises transformation/syntax diagnostics,
not semantic type checking. Valid source emits runnable JavaScript; malformed
`const = ;` produces diagnostics and clears previously published output.
Raw emitted JavaScript must match the selected pinned compiler API result; no
post-processing or replacement compiler. This is its published developer API,
not a code-style score. Actual package output goldens captured independently.
Actual source with typed box/optional chaining must execute to42 in originating
browser. Preserve supplied UI; no requirement for a different DOM layout.

## Indexed-resource browser

Provided Load action, Search editor, Region/Month/Sort selects, Next page and
Export actions; named read-only Status/Matching rows/Page outputs. Level1
100000rows, level2 1000000; algorithm/data generator shared, scale alone changes.
Zero-based indexi: id=i+1,customer=`Customer ${i%4096}`,regions North/South/East/
West by i%4,cents=(i*7919)%1000000,month=i%12+1. Filter/search combined;
sort cents-desc with id-asc tie, page100, JSON export all filtered sorted rows.
During real indexing, visible navigation/search remains usable; admission
records achieved timings/actual opportunity to intervene. Reference-grounded
final response deadline/finite upper-question rationale frozen before models;
no count-only closure. Independent scenario queries North/month1, exact
ceil(N/12) matching rows, page2, full unique/export identities/cents/order.
Resource bytes/rows/elapsed measured, unavailable memory explicit.

Preparation probes and source tests do not claim model success or boundary.
Different internals implementing these published interfaces remain valid.
