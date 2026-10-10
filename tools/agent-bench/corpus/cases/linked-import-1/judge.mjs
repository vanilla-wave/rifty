import assert from 'node:assert/strict';
import { createWorkbook } from './src/workbook.mjs';

function csvDiagnosticLocation(error) {
  const text = typeof error?.message === 'string' ? error.message : '';
  const named = /\bline\s*:?\s*(\d+)\s*[,;]?\s*(?:column|col)\s*:?\s*(\d+)/i.exec(text);
  const compact = /(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)/.exec(text);
  const position = named ?? compact;
  if (position) return { line: Number(position[1]), column: Number(position[2]) };
  return error ? { line: Number(error.line), column: Number(error.column) } : null;
}

const book = createWorkbook();
const customers = 'id,name\r\nc1,"Alpha, A"\r\nc2,"Beta ""B"""\r\n';
const invoices = 'id,customer_id,amount,currency\nc1-i,c1,100.01,USD\nc2-i,c2,2.00,EUR\n';
book.importFiles({ customers, invoices });
assert.deepEqual(book.snapshot().customers, [
  { id: 'c1', name: 'Alpha, A' },
  { id: 'c2', name: 'Beta "B"' },
]);
assert.deepEqual(book.snapshot().invoices, [
  { id: 'c1-i', customerId: 'c1', cents: 10001, currency: 'USD' },
  { id: 'c2-i', customerId: 'c2', cents: 200, currency: 'EUR' },
]);
const before = structuredClone(book.snapshot());
assert.throws(() =>
  book.importFiles({ customers, invoices: 'id,customer_id,amount,currency\nx,missing,1.00,USD\n' }),
);
assert.deepEqual(book.snapshot(), before);
assert.throws(() => book.importFiles({ customers: 'id,name\nc1,A\nc1,B\n', invoices }));
assert.deepEqual(book.snapshot(), before);
assert.throws(() =>
  book.importFiles({ customers, invoices: 'id,customer_id,amount,currency\nx,c1,1.005,USD\n' }),
);
assert.deepEqual(book.snapshot(), before);
const malformed = (() => {
  try {
    book.importFiles({ customers: 'id,name\nc1,"unfinished', invoices });
  } catch (e) {
    return e;
  }
})();
assert.deepEqual(csvDiagnosticLocation(malformed), { line: 2, column: 4 });
assert.deepEqual(book.snapshot(), before);
const multiline = 'id,name\nc1,"Alpha\nSecond"\nc2,Beta\n';
book.importFiles({ customers: multiline, invoices });
assert.equal(book.snapshot().customers[0].name, 'Alpha\nSecond');
const restored = createWorkbook();
restored.restoreJson(book.exportJson());
assert.deepEqual(restored.snapshot(), book.snapshot());
console.log('RIFTY_CORPUS_PASS:linked-import-1');
