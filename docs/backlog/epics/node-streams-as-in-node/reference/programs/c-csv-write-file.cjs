// exceljs 4.4.0 csv.writeFile: fast-csv's object-mode Transform piped into fs.createWriteStream.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const out = path.join(__dirname, 'out.csv');
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Revenue');
  ws.addRow(['Region', 'Revenue', 'Note']);
  ws.addRow(['North', 120, 'plain']);
  ws.addRow(['South, East', 95.5, 'has "quotes"']);
  ws.addRow(['Zürich ✓', -3, 'two\nlines']);
  try {
    await wb.csv.writeFile(out);
    const b = fs.readFileSync(out);
    console.log(
      'csv.writeFile',
      b.length,
      crypto.createHash('sha256').update(b).digest('hex').slice(0, 16),
    );
  } catch (e) {
    console.log('csv.writeFile threw', e2s(e));
  }
})();
