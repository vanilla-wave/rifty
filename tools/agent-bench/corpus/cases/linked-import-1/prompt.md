Implement the linked customer/invoice CSV workbook API: quoted/escaped/multiline CSV, exact cents, keys/references, atomic import and JSON restore.

Starting installed Vanilla JavaScript/Vite starter. Implement src/workbook.mjs; preserve existing starter/build. Level 1; only the base-level API/requirements are required; level2 additions are not required.

Published interfaces and observable requirements:


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


Provide tests for interactions/regressions. No subjective style score.
