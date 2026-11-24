// node csv-write.cjs <out>: exceljs's CSV writer (fast-csv's Transform subclass) over the workbook
// route; the bytes go to <out>.
const fs = require('node:fs');
const Workbook = require('exceljs/lib/doc/workbook');
const out = process.argv[2];
const wb = new Workbook();
const ws = wb.addWorksheet('Revenue');
ws.addRow(['Region', 'Revenue', 'Note']);
ws.addRow(['North', 120, 'plain']);
ws.addRow(['South, East', 95.5, 'has "quotes"']);
ws.addRow(['Zürich ✓', -3, 'two\nlines']);
ws.addRow(['Total', { formula: 'SUM(B2:B4)', result: 212.5 }, null]);
wb.csv
  .writeBuffer()
  .then((buf) => {
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
